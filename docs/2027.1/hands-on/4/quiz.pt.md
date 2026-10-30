Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

**Q1.** Por que o BoxOffice assina os tokens com **RS256** (assimétrico) em vez de **HS256** (segredo compartilhado)?

- A. Tokens RS256 são menores
- B. Só o `auth` tem a chave privada; o gateway (e qualquer serviço) verifica com a chave pública e nunca consegue emitir um token
- C. O HS256 não é suportado pelo Spring Security
- D. O RS256 criptografa o payload

??? success "Resposta"
    **B — Separação entre assinar e verificar.**

    Com HS256, o mesmo segredo assina e verifica, então todo verificador é também um falsificador em potencial, e o segredo precisa ser distribuído para todo lado. Com RS256, a chave pública pode ser publicada (JWKS) com segurança.

---

**Q2.** Com que frequência o gateway chama o `auth` para validar um token?

- A. A cada requisição
- B. Uma vez por sessão de usuário
- C. Ele busca o JWKS (chaves públicas) uma vez e o guarda em cache; cada token é verificado localmente, buscando de novo só para um `kid` desconhecido
- D. Nunca: o gateway não valida tokens

??? success "Resposta"
    **C — Verificação local.**

    Esse é todo o propósito dos tokens autocontidos: nenhuma chamada de rede por requisição, então o serviço de autenticação não fica no caminho crítico. O outro lado da moeda é a revogação — um token continua válido até o `exp`.

---

**Q3.** Um cliente envia uma requisição para `/auth/me` com `X-User-Id: <id do admin>` e sem token. O que acontece?

- A. O `auth` devolve o perfil do admin
- B. O gateway responde `401`: `/auth/me` exige um token e, de qualquer forma, o gateway remove headers `X-User-*` enviados pelo cliente
- C. O gateway responde `403`
- D. O edge bloqueia o header

??? success "Resposta"
    **B — 401, e o header seria removido de qualquer jeito.**

    `anyExchange().authenticated()` rejeita a requisição; e o `UserHeadersFilter` sempre apaga os headers `X-User-*` que chegam antes de definir os seus a partir de um token validado. Sem essa remoção, falsificar headers seria trivial.

---

**Q4.** Um fã com um token válido (scope `user`) envia `DELETE /catalog/events/2`. A resposta é:

- A. 200
- B. 401 Unauthorized
- C. 403 Forbidden
- D. 404 Not Found

??? success "Resposta"
    **C — 403.**

    401 significa "não sei quem você é" (token ausente/inválido); 403 significa "sei quem você é, e você não pode fazer isso" (a regra exige `SCOPE_admin`).

---

**Q5.** Por que `anyExchange().authenticated()` é a última regra?

- A. O Spring exige
- B. É um padrão seguro: qualquer rota acrescentada depois fica protegida, a menos que alguém a abra explicitamente
- C. Deixa as rotas abertas mais rápidas
- D. Desliga o CSRF

??? success "Resposta"
    **B — Negar por padrão.**

    As regras são avaliadas em ordem. Listar o que é aberto e proteger todo o resto faz com que esquecer uma regra falhe fechado (um 401) em vez de aberto (um vazamento de dados).

---

**Q6.** Seu teste de login mostra o `auth` saturando em ~15 logins/s com 1 CPU, enquanto o `/auth/me` atende milhares. Por quê?

- A. O banco é lento para logins
- B. O BCrypt com custo 10 gasta deliberadamente dezenas de milissegundos de CPU por verificação de senha
- C. Assinar o JWT leva 1 s
- D. Os logins usam HTTP/1.0

??? success "Resposta"
    **B — O hash de senhas é lento de propósito.**

    O fator de custo torna caro o ataque de força bruta a um hash vazado. Consequências para o design: emita tokens e reutilize-os, proteja o `/auth/login` com um rate limit rígido e escale o `auth` para o pico de logins (antes de uma venda relâmpago abrir).

---

**Q7.** O `auth` reinicia. O que acontece com os tokens emitidos antes do reinício, na implementação deste lab?

- A. Continuam funcionando
- B. São rejeitados: o par de chaves é gerado em memória na inicialização, então o `kid` antigo não está mais no JWKS
- C. São renovados automaticamente
- D. Só os tokens de admin são rejeitados

??? success "Resposta"
    **B — Chave perdida, tokens perdidos.**

    Sistemas em produção guardam a chave privada em um KMS/gerenciador de segredos, publicam a chave atual e a anterior durante a rotação e giram as chaves em um calendário. Duas réplicas do `auth` com chaves em memória seriam ainda piores: cada uma assinaria com uma chave diferente.

---

**Q8.** O que o gateway verifica em um JWT além da assinatura?

- A. Nada mais
- B. `exp`/`nbf` (janela de tempo), `iss` (o emissor esperado) e `aud` (o token é destinado a esta API)
- C. A senha do usuário
- D. O endereço IP que pediu o token

??? success "Resposta"
    **B — Tempo, emissor, audiência.**

    Um token corretamente assinado por outro emissor, ou emitido para outra API (audiência), não pode ser aceito. Pular a verificação do `aud` é uma vulnerabilidade clássica quando um provedor de identidade atende várias APIs.

---

**Q9.** Por que a identidade é propagada aos serviços como headers (`X-User-Id`) em vez de cada serviço validar o JWT de novo?

- A. Headers são criptografados
- B. Simplicidade e custo: uma validação no gateway; aceitável só enquanto os serviços forem alcançáveis exclusivamente pelo gateway (uma rede confiável) — designs zero trust revalidam ou usam mTLS
- C. Os serviços não sabem interpretar JSON
- D. JWTs não podem ser repassados

??? success "Resposta"
    **B — Um trade-off de fronteira de confiança.**

    O padrão é comum e barato, mas se apoia no isolamento de rede. Se um atacante alcançar um serviço diretamente, ele pode definir qualquer header. A aula 12 discute mTLS, service meshes e repassar o próprio token.

---

**Q10.** Por que há dois load balancers na topologia do lab 4 (o Nginx e o `lb://` do gateway)?

- A. Redundância: um é backup do outro
- B. Eles balanceiam camadas diferentes: o edge balanceia entre réplicas do gateway, o gateway entre instâncias dos serviços — como um load balancer público da nuvem na frente de uma frota de gateways que chamam os serviços por balanceamento de carga interno
- C. O Spring Cloud Gateway não consegue receber tráfego diretamente
- D. O Nginx não consegue rotear por caminho

??? success "Resposta"
    **B — Um balanceador por camada.**

    Cada camada escala de forma independente, então cada uma precisa da sua própria distribuição e dos seus health checks. No Kubernetes (lab 10), a Ingress/Gateway API e os Services fazem esses dois papéis.
