Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## A borda e sua segurança { #the-edge-and-its-security }

**Q1.** No caminho de uma requisição do BoxOffice *fã → DNS → CDN → WAF → load balancer → API gateway → ingress → `inventory`*, qual componente deve rejeitar uma requisição cujo JWT expirou?

- A. A CDN, porque é a mais próxima do fã
- B. O load balancer, porque ele já termina o TLS
- C. O API gateway, que centraliza a autenticação de todos os serviços
- D. O ingress, porque sabe qual Service do Kubernetes é dono da rota

??? success "Resposta"
    **C — O API gateway.**

    Validar a identidade (assinatura do JWT, expiração, audiência) é a tarefa transversal clássica do API gateway: é feita uma vez, de forma consistente, antes de qualquer serviço executar. A CDN e o load balancer não conhecem usuários (embora uma edge function *possa* pré-validar tokens), e o ingress só roteia por host e path. Os serviços ainda devem verificar a autorização sobre os próprios recursos (zero trust), mas rejeitar um token expirado é papel do gateway.

---

**Q2.** Às 10:00, uma botnet de 50.000 endereços IP residenciais envia requisições `GET /api/search?q=…` de aparência válida, cada uma cara para o backend. Qual defesa é a **menos** eficaz sozinha?

- A. Um rate limit de 100 requisições por minuto por endereço IP
- B. Cachear os resultados de busca na CDN por alguns segundos
- C. Um desafio JavaScript para clientes com fingerprint suspeito
- D. Uma sala de espera virtual que admite usuários a uma taxa controlada

??? success "Resposta"
    **A — Um rate limit por IP.**

    Cada bot pode enviar até 100 requisições por minuto sem nunca atingir o limite: 50.000 × 100 = 5 milhões de requisições por minuto (cerca de 83.000 por segundo), todas aceitas. Isso é um **DDoS de camada de aplicação (L7)** distribuído entre muitas origens: limites por IP mal o percebem. O cache torna baratas as requisições caras repetidas, os desafios filtram clientes automatizados e uma sala de espera limita a taxa que chega ao núcleo, não importa quantas sejam as origens.

---

**Q3.** Por que o **anycast** é eficaz contra ataques DDoS volumétricos?

- A. Ele criptografa o tráfego, então os atacantes não conseguem ler as respostas
- B. O mesmo endereço IP é anunciado a partir de muitas localidades, então o tráfego de uma botnet global se divide entre todas elas em vez de se concentrar em uma
- C. Ele bloqueia o tráfego UDP, usado pela maioria dos ataques
- D. Ele muda o endereço IP do site a cada poucos segundos

??? success "Resposta"
    **B — A inundação é dividida entre muitas localidades.**

    Com anycast, o roteamento entrega cada pacote à localidade mais próxima que anuncia o endereço. Uma botnet espalhada pelo mundo atinge, portanto, centenas de localidades de borda, cada uma recebendo uma fração do ataque — uma fração que uma CDN grande consegue absorver. É por isso que a proteção contra DDoS volumétrico costuma ser comprada de provedores com grandes redes anycast.

---

## DNS & CDN

**Q4.** O BoxOffice usa failover de DNS entre duas regiões. Os health checks rodam a cada 10 s, a primária é declarada não saudável após 3 falhas consecutivas e o TTL do registro é 60 s. No melhor caso, aproximadamente quanto tempo depois da falha da região primária os clientes que respeitam o TTL passam a usar a secundária?

- A. Cerca de 10 segundos
- B. Cerca de 30 segundos
- C. Cerca de 90 segundos
- D. Cerca de 10 minutos

??? success "Resposta"
    **C — Cerca de 90 segundos.**

    A detecção leva cerca de 3 × 10 s = 30 s; depois disso, os resolvers ainda podem manter a resposta antiga por até um TTL (60 s). Total ≈ 30 + 60 = 90 s no melhor caso. Na prática é mais: alguns resolvers e clientes guardam respostas por mais tempo que o TTL, e conexões abertas continuam usando a região antiga até caírem. Failover de DNS serve para desastres regionais, não para failover rápido no nível de instância.

---

**Q5.** A borda recebe 200.000 requisições por segundo de conteúdo estático. O hit ratio da CDN melhora de **95%** para **99%**. O que acontece com a carga na origem?

- A. Cai cerca de 4%, de 10.000 para 9.600 requisições por segundo
- B. Cai cerca de 80%, de 10.000 para 2.000 requisições por segundo
- C. Não muda; o hit ratio só afeta a latência
- D. Cai pela metade, de 10.000 para 5.000 requisições por segundo

??? success "Resposta"
    **B — De 10.000 para 2.000 req/s.**

    A origem vê a taxa de **miss**: 5% de 200.000 = 10.000 req/s antes, 1% de 200.000 = 2.000 req/s depois — cinco vezes menos. Pequenas mudanças no hit ratio perto de 100% são grandes mudanças na taxa de miss, que é o número que dimensiona a origem.

---

**Q6.** O BoxOffice faz deploy de um novo bundle JavaScript. Qual estratégia garante que nenhum fã execute uma mistura do HTML antigo com o JavaScript novo, sem depender de purges na CDN?

- A. Manter o nome `app.js` e definir `Cache-Control: no-store` nele
- B. Manter o nome `app.js`, fazer o deploy e removê-lo (purge) de todos os PoPs
- C. Dar ao bundle um nome baseado no conteúdo (`app.b71e02.js`), cacheado com `max-age=31536000, immutable`, e referenciá-lo a partir de uma página HTML com TTL curto
- D. Definir `max-age=60` em `app.js` e esperar um minuto após cada deploy

??? success "Resposta"
    **C — URLs com fingerprint (versionadas).**

    Uma nova versão ganha uma nova URL, então os caches nunca podem servir um arquivo antigo sob o nome novo; as versões antiga e nova coexistem enquanto o HTML de vida curta passa de uma para a outra. Purges são lentos, podem falhar e nunca chegam aos caches dos navegadores; `no-store` joga fora o benefício da CDN; um TTL de 60 s ainda deixa uma janela de versões misturadas.

---

**Q7.** Durante a venda, o endpoint de disponibilidade de assentos recebe 400.000 requisições por segundo de fãs fazendo polling. A resposta pode ter até um segundo de idade. Com `Cache-Control: s-maxage=1` e **40 PoPs da CDN** atendendo esses fãs (sem origin shield), qual é a taxa máxima de requisições que esse endpoint envia à origem?

- A. Cerca de 40 requisições por segundo
- B. Cerca de 4.000 requisições por segundo
- C. Cerca de 400.000 requisições por segundo
- D. Zero, porque a CDN nunca contata a origem para conteúdo cacheado

??? success "Resposta"
    **A — Cerca de 40 req/s.**

    Cada PoP busca o objeto no máximo uma vez por segundo, quando ele expira (um PoP × 1 req/s × 40 PoPs). Isso é **micro-caching**: um TTL curto em um endpoint dinâmico muito acessado transforma centenas de milhares de requisições por segundo em um punhado na origem, ao custo de até um segundo de defasagem. Um origin shield reduziria ainda mais, para cerca de uma requisição por segundo. A reserva (hold) em si ainda precisa ir à origem e ser conferida contra o banco de dados.

---

## Load balancing

**Q8.** Qual afirmação sobre load balancers **L4** e **L7** está correta?

- A. Um load balancer L4 consegue rotear `/api/holds` para `inventory` e `/api/orders` para `order`
- B. Um load balancer L7 escolhe um backend por requisição HTTP e pode rotear por path, host ou cabeçalho; um load balancer L4 escolhe por conexão e só enxerga IPs e portas
- C. Load balancers L4 sempre terminam o TLS
- D. Load balancers L7 são sempre mais rápidos que os L4 porque entendem o protocolo

??? success "Resposta"
    **B.**

    O L4 trabalha com conexões (TCP/UDP): rápido e agnóstico ao protocolo, mas cego para paths e cabeçalhos, e normalmente repassa o TLS sem terminá-lo. O L7 termina a conexão, lê cada requisição e pode rotear, repetir (retry), reescrever e balancear por requisição — a um custo de CPU maior por requisição.

---

**Q9.** Uma camada de cache usa `server = hash(key) mod N` com N = 4 servidores. Um quinto servidor é adicionado. Aproximadamente que fração das chaves passa a mapear para outro servidor, e quanto seria com consistent hashing?

- A. 20% com `mod N`; 80% com consistent hashing
- B. Cerca de 80% com `mod N`; cerca de 20% com consistent hashing
- C. 25% nos dois casos
- D. 100% com `mod N`; 0% com consistent hashing

??? success "Resposta"
    **B — Cerca de 80% vs cerca de 20%.**

    Com `mod N`, uma chave mantém seu servidor só se `hash mod 4 = hash mod 5`, o que acontece para cerca de 1 chave em 5, então ~80% mudam — quase todas as entradas do cache dão miss ao mesmo tempo. Com consistent hashing, o novo servidor assume só as chaves entre ele e seus predecessores no anel: cerca de **1/(N+1) = 1/5 = 20%**, exatamente a parcela que ele precisa ter de qualquer forma.

---

**Q10.** Por que as implementações de consistent hashing colocam cada servidor **muitas vezes** no anel (nós virtuais)?

- A. Para criptografar as chaves
- B. Para que os arcos entre os pontos se compensem, de modo que cada servidor fique com perto da sua parcela justa de chaves, e para espalhar as chaves de um servidor removido por todos os servidores restantes
- C. Para permitir que a mesma chave seja guardada em vários servidores, por durabilidade
- D. Para tornar as buscas O(1) em vez de O(log N)

??? success "Resposta"
    **B — Equilíbrio.**

    Com um ponto por servidor, posições aleatórias criam arcos de tamanhos muito diferentes: um servidor pode ficar com metade das chaves e outro com quase nenhuma. Com 100–200 pontos por servidor, a parcela de cada servidor é a soma de muitos arcos pequenos e se aproxima de 1/N. Quando um servidor sai, seus muitos arcos pequenos são herdados por muitos servidores diferentes. Replicação (C) é uma decisão de projeto separada, construída sobre o anel.

---

**Q11.** O serviço `order` chama `inventory` via gRPC através de um load balancer L4. Depois de escalar `inventory` de 3 para 6 pods, os pods novos quase não recebem tráfego. Qual é a causa mais provável?

- A. Os pods novos falharam nas readiness probes
- B. O gRPC usa conexões HTTP/2 de longa duração, e um load balancer L4 escolhe um backend só quando uma conexão é aberta; as conexões existentes continuam nos pods antigos
- C. O gRPC não suporta mais de três servidores
- D. O load balancer L4 usa consistent hashing sobre o path da requisição

??? success "Resposta"
    **B — Balanceamento por conexão de conexões de longa duração.**

    `order` multiplexa todas as suas chamadas sobre poucas conexões HTTP/2 abertas antes do scale-out. Correções: balanceamento L7 por requisição (Envoy, um service mesh), load balancing no lado do cliente gRPC, ou uma idade máxima de conexão para que os clientes se reconectem e se espalhem pelos pods novos.

---

## API gateway e rate limiting { #api-gateway-and-rate-limiting }

**Q12.** Um token bucket tem **capacidade 20** e **taxa de reposição de 10 tokens/s**. Um fã que ficou ocioso por um minuto envia 50 requisições no mesmo instante. Quantas são aceitas imediatamente, e qual é a taxa sustentada máxima depois disso?

- A. 50 aceitas; depois 20 por segundo
- B. 20 aceitas; depois 10 por segundo
- C. 10 aceitas; depois 10 por segundo
- D. 30 aceitas; depois 20 por segundo

??? success "Resposta"
    **B — 20 agora, 10 por segundo depois.**

    Após um longo período ocioso o balde está cheio (capacidade 20, nunca mais que isso). A rajada instantânea consome os 20 tokens; as outras 30 requisições são rejeitadas com `429`. A partir daí, os tokens chegam a 10 por segundo, então essa é a taxa sustentada máxima: a capacidade define a **rajada (burst)**, a reposição define a **média**.

---

**Q13.** Um limitador de **janela fixa** permite 100 requisições por minuto por usuário. Qual é o maior número de requisições que um usuário consegue ter aceitas em qualquer intervalo de 2 segundos?

- A. 100
- B. Cerca de 3, porque 100 por minuto é menos de 2 por segundo
- C. 200, enviando 100 no fim de uma janela e 100 no início da seguinte
- D. Ilimitado, porque o contador zera a cada minuto

??? success "Resposta"
    **C — 200.**

    Esse é o **problema da fronteira** das janelas fixas: 100 requisições às 10:00:59 enchem a janela das 10:00, e mais 100 às 10:01:00 enchem a janela das 10:01 — 200 aceitas em cerca de um segundo, o dobro da taxa pretendida. O sliding window log (exato) ou o sliding window counter (aproximação ponderada) resolvem isso.

---

**Q14.** O BoxOffice roda **6 réplicas do gateway** atrás de um load balancer, e cada réplica guarda seus contadores de rate limit na memória local, com limite de 10 req/s por usuário. As requisições se espalham igualmente entre as réplicas. Que limite o usuário tem de fato, e qual é a correção usual?

- A. 10 req/s; nenhuma correção necessária
- B. Até cerca de 60 req/s; guardar os contadores em um store compartilhado como o Redis e atualizá-los de forma atômica (por exemplo, com um script Lua)
- C. Cerca de 1,7 req/s; aumentar o limite para 60
- D. 10 req/s, mas só se sticky sessions estiverem habilitadas

??? success "Resposta"
    **B — Até 6× o limite; use um contador compartilhado e atômico.**

    Cada réplica vê um sexto das requisições do usuário e aplica o limite inteiro a elas, então o limite efetivo é ~60 req/s. Um store compartilhado (Redis) com um read-modify-write atômico (um script Lua, ou `INCR` com expiração para janelas) dá uma contagem única e consistente. As alternativas aceitam aproximação: cada réplica aplica `limit / replicas`, ou as réplicas sincronizam os contadores de forma assíncrona. Sticky sessions ajudariam só em parte e prejudicariam o load balancing.

---

## Protocolos { #protocols }

**Q15.** O mapa de assentos precisa mostrar, para milhões de navegadores, cada assento que passa a estar reservado ou vendido em cerca de um segundo. Os clientes nunca enviam dados de volta por esse canal. Qual é a escolha mais simples que atende ao requisito?

- A. WebSockets, porque são o protocolo de tempo real mais rápido
- B. Server-Sent Events: uma resposta HTTP de longa duração que transmite eventos, com reconexão automática e retomada via `Last-Event-ID`
- C. Streaming bidirecional gRPC a partir do navegador
- D. Long polling com timeout de 60 segundos e sem cache

??? success "Resposta"
    **B — Server-Sent Events.**

    O tráfego é **unidirecional** (servidor → cliente), então SSE se encaixa exatamente: é HTTP comum (funciona através de CDNs, proxies e da multiplexação do HTTP/2), e o `EventSource` se reconecta e retoma sozinho. WebSockets funcionariam, mas acrescentam um canal bidirecional com estado, tratamento de upgrade e reconexão customizada sem nenhum benefício. O gRPC não está disponível nativamente nos navegadores. Polling com micro-caching na CDN também é um projeto válido, e até mais barato, se um atraso de alguns segundos for aceitável.
