Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** Por que o `catalog` pode ser escalado para três réplicas sem mudar o seu código (fora o cabeçalho `X-Instance`)?

- A. O Spring Boot replica a memória entre as instâncias
- B. Ele é **stateless**: toda requisição carrega tudo de que precisa, e todo o estado compartilhado fica no PostgreSQL, então qualquer réplica pode responder a qualquer requisição
- C. O Nginx copia a sessão para todas as réplicas
- D. O Docker Compose sincroniza as réplicas

??? success "Resposta"
    **B — Serviços stateless escalam horizontalmente.**

    Se uma réplica guardasse dados do usuário em memória (uma sessão, um carrinho de compras), as requisições teriam de voltar para a mesma réplica (sticky sessions) e uma queda perderia dados. Empurrar o estado para um banco ou um cache é a pré-condição para um scale-out fácil.

---

**Q2.** Com a configuração padrão de upstream do Nginx, como as requisições são distribuídas?

- A. Aleatoriamente
- B. Round robin: cada réplica na sua vez
- C. Para a réplica com menos CPU em uso
- D. Por hash do IP do cliente

??? success "Resposta"
    **B — Round robin.**

    Por isso 9 requisições dão 3 por réplica. `least_conn` (menos conexões ativas), `ip_hash`/`hash` (afinidade) e `random two least_conn` (power of two choices) são alternativas, escolhidas com uma diretiva.

---

**Q3.** O `catalog-3` está **pausado** (congelado) enquanto o k6 manda 150 req/s. O que os clientes percebem?

- A. Erros `502` imediatos
- B. Absolutamente nada
- C. Uma rajada de requisições que levam cerca de `proxy_read_timeout` (5 s) antes de o Nginx repeti-las em outra réplica, depois latência normal assim que a réplica é marcada como falha
- D. Todas as requisições falham até a réplica ser despausada

??? success "Resposta"
    **C — Falhas lentas custam um timeout cada.**

    Um processo congelado aceita a conexão TCP mas nunca responde, então o Nginx só consegue detectá-lo esperando. Depois de `max_fails` ele para de mandar tráfego por `fail_timeout`. Uma réplica que caiu, ao contrário, recusa a conexão e o retry é imediato.

---

**Q4.** Por que `proxy_next_upstream` é seguro para `GET /catalog/events/1`, mas não, por padrão, para um `POST`?

- A. Corpos de POST são grandes demais para reenviar
- B. GET é idempotente: repeti-lo não tem efeito extra; um POST pode já ter sido processado pela primeira réplica, e reenviá-lo poderia, por exemplo, criar dois pedidos
- C. O Nginx não consegue fazer proxy de requisições POST
- D. O HTTP proíbe retries

??? success "Resposta"
    **B — Só faça retry de requisições idempotentes.**

    Um timeout não diz se o servidor fez o trabalho. Repetir operações não idempotentes exige uma chave de idempotência (aula 5, lab 9). O Nginx só repete métodos não idempotentes com `non_idempotent` definido explicitamente.

---

**Q5.** Por que não colocar `proxy_read_timeout 100ms` para detectar réplicas congeladas mais rápido?

- A. O Nginx não aceita valores abaixo de 1 s
- B. Requisições legitimamente lentas (uma listagem sob carga) seriam tratadas como falhas e repetidas, acrescentando carga justamente quando o sistema está sofrendo
- C. Isso desligaria o keep-alive
- D. Só se aplica a POST

??? success "Resposta"
    **B — Timeouts vêm da latência medida.**

    Defina-os um pouco acima do p99,9 saudável do endpoint. Longos demais, e uma réplica lenta prejudica muitas requisições; curtos demais, e você cria falhas e retry storms a partir de uma lentidão normal.

---

**Q6.** O cliente `greedy` manda 50 req/s por 30 s com um limite de 20 r/s e `burst=40 nodelay`. Mais ou menos quantas requisições têm sucesso?

- A. 600
- B. 640
- C. 1.500
- D. 40

??? success "Resposta"
    **B — ≈ 640.**

    20 req/s × 30 s = 600 permitidas pela taxa, mais a rajada de 40 atendida imediatamente no início. As outras ≈ 860 recebem `429 Too Many Requests` — de forma barata, na borda, sem tocar nas réplicas.

---

**Q7.** Por que o lab aplica o rate limit por `X-Api-Key` e não pelo IP do cliente?

- A. O Nginx não consegue ler endereços IP
- B. Todo o tráfego do k6 vem de um único IP, então um limite por IP estrangularia os testes de carga; em produção você limita identidades autenticadas e também IPs anônimos
- C. Limites por IP são ilegais
- D. Chaves de API são criptografadas

??? success "Resposta"
    **B — Uma restrição do lab, explicada.**

    Limites por IP também erram o alvo atrás de NATs (uma universidade inteira atrás de um único endereço). E um cabeçalho escolhido pelo cliente pode ser trocado por um atacante — por isso limites reais usam identidades verificadas (chaves de API que você emitiu, ids de usuário vindos de JWTs).

---

**Q8.** Você mede uma capacidade de 400 req/s com 1 réplica e de 960 req/s com 3. Qual é a eficiência de escala, e a causa mais provável da diferença?

- A. 100%; não há diferença
- B. 80%; as três réplicas compartilham um banco (e um notebook), que vira o recurso disputado
- C. 33%; o Nginx tem uma única thread
- D. 240%; o cache entrou em ação

??? success "Resposta"
    **B — 960 / (3 × 400) = 80%.**

    Escalar a camada stateless passa a pressão para a camada stateful compartilhada. A Universal Scalability Law captura isso: os custos de contenção (e de coerência) fazem o throughput crescer de forma sublinear com o número de nós.

---

**Q9.** Qual é a vantagem da flag `resolve` nos servidores do upstream?

- A. Ela criptografa o tráfego para as réplicas
- B. O Nginx resolve os nomes pelo DNS do Docker em tempo de execução: ele sobe mesmo com uma réplica fora do ar e percebe quando uma réplica volta com um IP novo
- C. Ela habilita HTTP/2
- D. Ela faz cache das respostas

??? success "Resposta"
    **B — Resolução dinâmica de nomes.**

    Sem ela, o Nginx resolve os nomes do upstream uma vez na inicialização e se recusa a subir se um nome não resolve — uma queda clássica quando uma dependência é reiniciada ou reagendada com um endereço novo.

---

**Q10.** Qual afirmação sobre health checks está correta?

- A. O Nginx open source sonda ativamente `/actuator/health` a cada poucos segundos
- B. Checks passivos aprendem com falhas de requisições reais; checks ativos sondam um endpoint periodicamente e podem remover uma réplica antes que os usuários a atinjam
- C. Health checks só são necessários no Kubernetes
- D. Um liveness check que passa significa que a réplica pode atender tráfego

??? success "Resposta"
    **B — Passivo vs ativo.**

    O Nginx open source é passivo (`max_fails`). Envoy, HAProxy, balanceadores de carga da nuvem, o Spring Cloud LoadBalancer (lab 4) e as readiness probes do Kubernetes (lab 10) fazem checks ativos. E *readiness* (pode atender) é diferente de *liveness* (processo vivo).
