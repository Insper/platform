Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## API Gateway

**Q1.** Por que os outros microsserviços **não expõem as suas portas** diretamente no `compose.yaml`?

- A. O Docker Compose não suporta vários mapeamentos de porta em um único arquivo
- B. Expor várias portas entraria em conflito com as regras de firewall do host
- C. Só o gateway fica exposto à internet; todos os outros serviços vivem na rede interna do Docker e só podem ser alcançados por meio do gateway
- D. O Spring Boot não permite que vários serviços rodem em portas diferentes

??? success "Resposta"
    **C — Só o gateway fica exposto à internet.**

    O isolamento de portas é uma propriedade de segurança: nenhum cliente externo consegue alcançar `account-service:8080` ou `auth-service:8080` diretamente. Eles só podem ser alcançados por meio do gateway, que aplica autenticação, limitação de taxa (rate limiting) e regras de roteamento. Esse padrão de "camada confiável" significa que uma requisição externa maliciosa só consegue entrar por um único ponto controlado.

---

**Q2.** Que framework o **Spring Cloud Gateway** usa internamente, e qual vantagem isso traz?

- A. Spring MVC (baseado em servlets) — o framework Spring mais estável
- B. Spring WebFlux (reativo/não bloqueante) — trata grandes volumes de conexões concorrentes com um número pequeno de threads
- C. Spring Batch — otimizado para processamento de requisições em lote
- D. Spring Integration — projetado para padrões de mensageria corporativa

??? success "Resposta"
    **B — Spring WebFlux (reativo).**

    O gateway é um ponto de estrangulamento de alta concorrência — todo o tráfego passa por ele. O WebFlux usa um modelo de event loop (como o Node.js) em vez de uma thread por requisição. Um gateway que trata 10.000 conexões concorrentes precisa de ~10 threads com WebFlux, contra ~10.000 threads com um servlet container tradicional — uma diferença enorme em memória e em custo de escalonamento.

---

**Q3.** Qual é o propósito da **configuração de CORS** no gateway?

- A. Criptografar requisições cross-origin usando certificados TLS
- B. Bloquear todas as requisições vindas de fora da rede interna do Docker
- C. Especificar quais origens de navegador têm permissão para fazer requisições cross-origin à API
- D. Comprimir as respostas enviadas a clientes cross-origin

??? success "Resposta"
    **C — Especifica quais origens de navegador podem fazer requisições cross-origin.**

    Os navegadores aplicam a Same-Origin Policy (política de mesma origem): um app JavaScript em `frontend.example.com` não pode chamar `api.example.com` a menos que o servidor permita explicitamente. A configuração de CORS do gateway adiciona `Access-Control-Allow-Origin` (e cabeçalhos relacionados) às respostas, avisando ao navegador que é seguro permitir a requisição cross-origin.

---

**Q4.** No `application.yaml`, as rotas do gateway são configuradas com `uri: lb://account`. O que significa o prefixo `lb://`?

- A. Usa o balanceador de carga da máquina host
- B. Habilita o balanceamento de carga no lado do cliente do Spring Cloud LoadBalancer entre todas as instâncias registradas do serviço `account`
- C. Conecta a um balanceador de carga Nginx externo
- D. Roteia para o serviço account pela interface de loopback do Linux

??? success "Resposta"
    **B — Balanceamento de carga no lado do cliente via Spring Cloud LoadBalancer.**

    `lb://account` diz ao Spring Cloud Gateway para resolver `account` pelo registro de serviços (ou pelo DNS do Docker, dependendo da configuração) e aplicar balanceamento de carga no lado do cliente entre todas as instâncias saudáveis. O prefixo `lb://` é a abstração do Spring sobre vários backends de descoberta (Eureka, Consul, DNS do Kubernetes).

---

**Q5.** A entrada do gateway no `compose.yaml` tem `depends_on: [account]`. Quando adicionar `condition: service_healthy` a essa dependência seria importante?

- A. Nunca — o gateway sobe rápido e o serviço account está sempre pronto antes
- B. Quando a rotina de inicialização do gateway faz chamadas HTTP imediatas ao account (p. ex., validação de rotas), ele precisa que o account esteja totalmente inicializado, e não apenas iniciado
- C. Só em produção — o desenvolvimento local nunca tem problemas de ordem de inicialização
- D. É exigido pela especificação do Docker Compose para todas as entradas `depends_on`

??? success "Resposta"
    **B — Quando o gateway faz chamadas HTTP ao serviço downstream durante a inicialização.**

    Se o gateway valida rotas ou busca configurações do account na inicialização, e o processo do account já subiu mas a conexão com o banco de dados ainda não está pronta, o gateway falha ao iniciar. `condition: service_healthy` espera até que o health check do account (p. ex., `/actuator/health`) retorne 200 antes de iniciar o gateway.
