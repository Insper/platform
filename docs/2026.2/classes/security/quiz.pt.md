Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Fundamentos

**Q1.** Um cliente logado chama `GET /orders/123` e recebe um pedido que pertence a outro cliente. O gateway validou o token corretamente. O que está faltando?

- A. Autenticação — o gateway deveria ter devolvido `401 Unauthorized`
- B. Autorização no nível do objeto — o `order-service` precisa verificar se o pedido `123` pertence ao `id-account` de quem chamou
- C. TLS — a resposta foi lida por alguém no meio do caminho
- D. Uma expiração de token mais longa

??? success "Resposta"
    **B — Autorização no nível do objeto no `order-service`.**

    Quem chamou *está* autenticado: o token é válido, então `401` estaria errado. A falha é de autorização: só o `order-service` sabe quem é o dono do pedido `123`, então ele precisa comparar o dono com a identidade que o gateway repassou e responder `403 Forbidden` (ou `404`) caso contrário. Isso é Broken Object Level Authorization, o primeiro item do OWASP API Security Top 10 (2023).

---

## OAuth 2.0 e OIDC

**Q2.** No OAuth 2.0, qual papel emite access tokens?

- A. Resource Owner
- B. Client
- C. Authorization Server
- D. Resource Server

??? success "Resposta"
    **C — Authorization Server.**

    O Authorization Server autentica o usuário, obtém o seu consentimento e emite os tokens. O Resource Server valida tokens, mas nunca os cria. O Client solicita tokens em nome do Resource Owner.

---

**Q3.** Por que o PKCE (Proof Key for Code Exchange) é obrigatório para clientes públicos (aplicativos móveis/SPA)?

- A. Ele criptografa o access token em trânsito
- B. Ele impede ataques de interceptação do authorization code — o código sozinho é inútil sem o code_verifier, que só o cliente legítimo possui
- C. Ele substitui o client_secret de clientes confidenciais
- D. Ele estende a validade do access token

??? success "Resposta"
    **B — Ele impede ataques de interceptação do authorization code.**

    Clientes públicos não conseguem guardar um client_secret com segurança. O PKCE gera um `code_verifier` aleatório, calcula o hash dele para obter um `code_challenge` (SHA-256, base64url) e envia o challenge na requisição de autorização. Só o cliente original consegue concluir a troca do código por tokens, porque só ele conhece o verifier. O PKCE não substitui o segredo de um cliente confidencial — a boa prática atual (RFC 9700) recomenda o PKCE *também* para clientes confidenciais.

---

**Q4.** Qual claim de um ID Token do OIDC comprova para qual aplicação o token foi emitido?

??? success "Resposta"
    **`aud` (audience)** — deve conter o `client_id` da aplicação que o recebe. Se o `aud` de um token não corresponder, o cliente deve rejeitá-lo, para evitar ataques de substituição de token, em que um token emitido para um aplicativo é reutilizado contra outro. Resource servers aplicam a mesma regra aos access tokens: rejeitam qualquer token cujo `aud` não seja a sua própria API.

---

**Q5.** O aplicativo móvel da loja tem um access token cujo `exp` é daqui a 5 minutos. O que o **aplicativo** deve fazer quando ele expirar?

??? success "Resposta"
    **Usar o refresh_token para solicitar um novo access_token ao Authorization Server.** O aplicativo não deve pedir ao usuário que faça login de novo só porque um access token expirou — é para isso que servem os refresh tokens. O refresh token tem vida longa, é guardado com segurança pelo cliente e enviado apenas ao Authorization Server. Só quando o próprio refresh token expira ou é revogado o usuário precisa fazer login novamente. (Um resource server que recebe o token expirado simplesmente responde `401`; ele não renova nada.)

---

**Q6.** Para que serve o endpoint JWKS?

??? success "Resposta"
    **Ele publica as chaves públicas de assinatura do Authorization Server**, para que os Resource Servers e o Gateway validem as assinaturas de JWT localmente, sem chamar o servidor de autenticação a cada requisição. Cada chave tem um `kid`, e o header de cada JWT indica o `kid` que o assinou. A rotação de chaves é feita atualizando o JWKS — os serviços buscam o JWKS de novo diante de um `kid` desconhecido, então sempre usam as chaves atuais sem um novo deploy.

---

**Q7.** Qual é a diferença essencial entre um ID Token e um Access Token?

??? success "Resposta"
    **ID Token = quem é o usuário (identidade). Access Token = o que o cliente pode fazer (autorização).** O ID Token é consumido pelo Client para conhecer o usuário e estabelecer uma sessão; seu destinatário (audience) é o cliente. O Access Token é enviado aos Resource Servers para autorizar chamadas à API; o cliente deve tratá-lo como opaco e nunca interpretá-lo. APIs não devem aceitar ID tokens.

---

**Q8.** Um microsserviço precisa chamar outro microsserviço sem nenhum usuário envolvido (job em segundo plano). Qual tipo de grant do OAuth 2.0 ele deve usar?

??? success "Resposta"
    **O grant Client Credentials.** O serviço que chama se autentica com as próprias credenciais (`client_id` e `client_secret`, ou uma asserção assinada) para obter um access token com os escopos de que precisa, como `stock:read`. Não há contexto de usuário, o que o torna a escolha correta para comunicação máquina a máquina, como jobs em segundo plano, tarefas agendadas ou pipelines de dados entre serviços.

---

**Q9.** No Hands-on 3, o gateway chama `POST /auth/solve` a cada requisição. Um colega propõe migrar para tokens RS256 validados localmente no gateway com um JWKS. Qual afirmação sobre essa mudança está correta?

- A. A validação local é sempre estritamente melhor — não há trade-off
- B. A validação local elimina um salto de rede e continua funcionando se o `auth-service` cair, mas um token não pode mais ser rejeitado antes do seu `exp`
- C. A validação local exige copiar o segredo HMAC para o gateway
- D. A validação local torna o logout imediato

??? success "Resposta"
    **B — Mais rápida e mais disponível, mas a revogação espera o `exp`.**

    Com chaves assimétricas, o gateway só precisa da chave **pública** do JWKS, então nenhum segredo é copiado (C está errada) e nenhuma chamada é feita por requisição. O preço é a revogação: um JWT autocontido continua válido até expirar, então o logout não é imediato (D está errada). É por isso que access tokens validados localmente têm vida curta e são combinados com refresh tokens; `/auth/solve` é uma forma de token introspection, que dá revogação imediata ao custo de um salto por requisição.

---

## Zero Trust e segredos

**Q10.** No mTLS, o que o cliente apresenta que NÃO apresenta no TLS padrão?

??? success "Resposta"
    **O seu próprio certificado X.509** (e uma prova de que possui a chave privada correspondente). No TLS padrão, apenas o servidor é autenticado perante o cliente. No mTLS, servidor e cliente apresentam certificados, de modo que cada lado conhece a identidade do outro — por exemplo, o SPIFFE ID `spiffe://cluster.local/ns/store/sa/order-service`. O mTLS só prova *quem* está chamando; uma política de autorização ainda decide *se* quem chama pode chamar.

---

**Q11.** O que significa "nunca confie, sempre verifique" no contexto do Zero Trust, especificamente para chamadas entre serviços internos?

??? success "Resposta"
    **Mesmo uma chamada do serviço A para o serviço B dentro do mesmo cluster Kubernetes precisa apresentar uma credencial de identidade válida e ser autorizada contra uma política.** Estar na rede interna não confere confiança — toda requisição é tratada como potencialmente hostil. Isso impede o movimento lateral após uma invasão: um atacante que comprometeu um serviço não consegue alcançar os outros livremente.

---

**Q12.** Você aplica uma NetworkPolicy que permite apenas que o `gateway-service` alcance o `order-service`, em um cluster minikube padrão. A partir de outro pod, `curl order-service:8080` continua funcionando. Qual é a causa mais provável?

- A. NetworkPolicies se aplicam apenas ao tráfego de saída (egress)
- B. O plugin de rede (CNI) do cluster não aplica NetworkPolicy, então o objeto é aceito, mas ignorado
- C. NetworkPolicies levam 24 horas para se propagar
- D. A porta 8080 está sempre aberta no Kubernetes

??? success "Resposta"
    **B — O plugin CNI não aplica a NetworkPolicy.**

    A API do Kubernetes armazena objetos NetworkPolicy em qualquer cluster, mas quem os aplica é o plugin de rede. Calico e Cilium aplicam as políticas; a rede padrão do minikube não. Inicie o minikube com `--cni=calico` para ver a política fazer efeito.

---

**Q13.** Por que os Secrets do Kubernetes NÃO são considerados seguros por padrão?

??? success "Resposta"
    **Os Secrets são armazenados como strings codificadas em base64 no etcd, e base64 não é criptografia — pode ser decodificado trivialmente** (`echo c3RvcmU= | base64 -d` imprime `store`). Sem criptografia em repouso no etcd e sem RBAC rigoroso sobre os Secrets, qualquer principal com permissão para ler Secrets — ou para criar um pod que os monte — consegue lê-los em texto puro. Sistemas em produção habilitam a criptografia em repouso, mantêm os manifestos de segredos fora do Git e frequentemente usam um gerenciador de segredos externo, como o HashiCorp Vault ou o AWS Secrets Manager.

---

**Q14.** Qual é o principal benefício de segurança dos **segredos dinâmicos** do Vault para o acesso do `order-service` ao banco de dados?

- A. A senha do banco de dados é mais longa
- B. Cada solicitante recebe uma credencial única e de vida curta, que o Vault revoga quando o lease expira; assim, uma credencial roubada deixa de funcionar sozinha e todo uso pode ser atribuído a alguém
- C. A senha fica armazenada em um ConfigMap em vez de um Secret
- D. O banco de dados deixa de precisar de autenticação

??? success "Resposta"
    **B — Credenciais únicas, de vida curta e revogadas automaticamente.**

    Com uma senha estática compartilhada por todas as réplicas, um vazamento continua válido até que alguém perceba e a rotacione — e a rotação quebra todo mundo. Com segredos dinâmicos, o Vault cria um usuário de banco por lease (por exemplo, uma hora) e o remove ao expirar; o log de auditoria mostra qual workload usou qual credencial.
