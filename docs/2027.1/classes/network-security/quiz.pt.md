
Clique em **"Resposta"** para revelar a resposta correta e a explicação.

---

## Modelagem de ameaças e o OWASP API Top 10

**Q1.** Em uma sessão de STRIDE sobre o checkout do BoxOffice, o time anota: *"um atacante envia um webhook falso de `pagamento capturado` para o nosso endpoint, e emitimos ingressos que nunca foram pagos."* Qual categoria STRIDE é essa, e qual é o melhor controle?

- A. Repúdio — manter um log de auditoria de webhooks mais longo
- B. Falsificação de identidade (spoofing) — verificar a assinatura do webhook do provedor (HMAC) e consultar de novo o status do pagamento antes de emitir ingressos
- C. Negação de serviço — aplicar rate limit ao endpoint do webhook
- D. Vazamento de informação — criptografar o corpo do webhook

??? success "Resposta"
    **B — Falsificação de identidade (spoofing).**

    O atacante finge ser o provedor de pagamentos: uma violação de autenticação. O controle é autenticar o remetente (verificar a assinatura HMAC com o segredo compartilhado do webhook) e, como o webhook é uma entrada externa (OWASP API10, consumo inseguro de APIs), confirmar o status chamando a API do provedor antes de agir. Rate limiting ajuda contra inundações, mas não impede uma única chamada forjada.

---

**Q2.** Um usuário logado troca a URL de `/orders/1042` para `/orders/1043` e vê o pedido de outro cliente, incluindo nome e números dos assentos. O gateway validou o JWT corretamente. Qual risco da OWASP API é esse, e onde ele precisa ser corrigido?

- A. API2 Broken Authentication — corrigir no gateway validando o `aud`
- B. API8 Security Misconfiguration — corrigir com uma regra de WAF
- C. API1 Broken Object Level Authorization — corrigir no serviço `order`, que precisa verificar se o pedido pertence a quem chama
- D. API4 Unrestricted Resource Consumption — adicionar paginação

??? success "Resposta"
    **C — BOLA, corrigido no serviço que é dono dos dados.**

    A autenticação funcionou: o gateway sabe que quem chama é `acc-42`. O que falhou foi a verificação *por objeto*: só `order` sabe quem é o dono do pedido 1043. Essa verificação não pode ser centralizada na borda. Devolva `404` (ou `403`) quando o pedido não for de quem chama, e escreva um teste "usuário A pede o pedido do usuário B".

---

**Q3.** Bots cambistas abrem milhares de reservas de assento às 10:00 e revendem os ingressos. Qual combinação trata melhor o OWASP API6 (Unrestricted Access to Sensitive Business Flows)?

- A. Criptografar a requisição de reserva com TLS 1.3
- B. Mover o banco de inventário para uma sub-rede isolada
- C. Ligar o mTLS estrito no service mesh
- D. Detecção de bots no WAF, limites de reservas por conta e por IP, uma sala de espera e um TTL curto para a reserva

??? success "Resposta"
    **D — Proteger o próprio fluxo de negócio.**

    Os bots usam a API exatamente como projetada; nada está tecnicamente "quebrado". A correção é limitar quanto do fluxo um único ator consegue consumir (limites por conta/IP, teto de compras), detectar automação (regras de bot no WAF, atestação do dispositivo, CAPTCHA), suavizar a rajada (sala de espera) e liberar rapidamente reservas não usadas (TTL). TLS, sub-redes e mTLS protegem outras camadas e não fazem nada contra um cliente de aparência legítima.

---

## Redes em nuvem

**Q4.** O BoxOffice planeja sub-redes privadas de aplicação `/24` em cada AZ, e o Kubernetes dá a cada pod um IP da VPC. Quantos endereços pods e nós conseguem de fato usar em uma sub-rede dessas na AWS?

- A. 256
- B. 254
- C. 251
- D. 65 531

??? success "Resposta"
    **C — 251.**

    Um `/24` tem 2⁸ = 256 endereços, e a AWS reserva 5 em toda sub-rede (endereço de rede, roteador da VPC, DNS, um para uso futuro, broadcast). 251 endereços divididos entre nós e pods se esgotam no primeiro grande evento de autoscaling — por isso o plano do BoxOffice usa sub-redes de aplicação `/19` (8 187 endereços utilizáveis cada).

---

**Q5.** O que torna uma sub-rede **pública** na AWS?

- A. A sua tabela de rotas tem uma rota `0.0.0.0/0` para um Internet Gateway
- B. Uma caixinha "pública" marcada na sub-rede
- C. O seu CIDR está fora das faixas da RFC 1918
- D. Ela contém um NAT gateway

??? success "Resposta"
    **A — A rota para o Internet Gateway.**

    "Pública" é consequência do roteamento: recursos com IP público nessa sub-rede podem ser alcançados pela Internet e alcançá-la (se os security groups permitirem). Sub-redes privadas roteiam `0.0.0.0/0` para um NAT gateway (só saída); sub-redes isoladas não têm rota padrão. O NAT gateway em si *vive* em uma sub-rede pública, mas isso é consequência, não definição.

---

**Q6.** O provedor de pagamentos só aceita chamadas de IPs em uma allow-list. O BoxOffice roda em três AZs com **um único** NAT gateway, na AZ a, para todas as sub-redes privadas. A AZ a cai. O que acontece?

- A. Nada: NAT gateways se replicam automaticamente entre AZs
- B. Os pods das AZs b e c perdem acesso de saída à Internet, então `payment` não alcança o provedor e o checkout falha, mesmo com a aplicação saudável em duas AZs
- C. O tráfego passa automaticamente para o Internet Gateway com os IPs privados dos pods
- D. Só o tráfego de entrada é afetado

??? success "Resposta"
    **B — Um único NAT é um ponto único de falha para a saída.**

    Um NAT gateway vive em uma AZ. O projeto resiliente é um NAT por AZ, com cada sub-rede privada roteando para o NAT da sua própria AZ — e cadastrando os três Elastic IPs no provedor. Custa cerca de três vezes mais em cobrança horária de NAT: um trade-off deliberado entre disponibilidade e custo, que vale a pena porque a saída para o provedor está no caminho crítico do checkout.

---

**Q7.** Qual afirmação sobre **security groups** e **network ACLs** está correta?

- A. Ambos são stateless e precisam permitir o tráfego de retorno explicitamente
- B. Security groups se aplicam a sub-redes; NACLs a interfaces de rede
- C. Security groups são stateful e podem referenciar outros security groups; NACLs são stateless, se aplicam a sub-redes e aceitam regras de negação
- D. NACLs podem referenciar security groups como origem

??? success "Resposta"
    **C.**

    Um security group permite automaticamente a resposta a uma requisição permitida (stateful) e pode dizer "permitir 5432 a partir de `sg-app`", o que acompanha os workloads quando eles escalam. Uma NACL avalia cada pacote nos dois sentidos (stateless, então portas efêmeras precisam ser abertas para as respostas), atua no nível da sub-rede e aceita negação explícita — útil como proteção grossa.

---

**Q8.** Cada um de 30 nós baixa cerca de 2 GB de imagens por dia pelo NAT gateway, mais 50 GB/dia de logs enviados ao object storage. Suponha (de forma ilustrativa) que o processamento de dados do NAT custe US$ 0,045 por GB. Aproximadamente quanto, por mês de 30 dias, um gateway endpoint para o object storage mais um interface endpoint para o registry poderiam tirar da conta do NAT (só processamento de dados)?

- A. Cerca de US$ 15
- B. Cerca de US$ 150
- C. Cerca de US$ 1 500
- D. Cerca de US$ 15 000

??? success "Resposta"
    **B — Cerca de US$ 150.**

    Por dia: 30 × 2 GB + 50 GB = 110 GB. Por mês: 110 × 30 = 3 300 GB. 3 300 × 0,045 ≈ US$ 148. (Interface endpoints têm as suas próprias tarifas por hora e por GB, menores que as do NAT para esse tráfego; o gateway endpoint do S3 é gratuito.) A estrutura — por hora + por GB — importa mais que o preço exato, que muda com o tempo: confira sempre os preços atuais do seu provedor.

---

## Service mesh

**Q9.** O Istio está instalado com mTLS em modo **STRICT**, mas não existe nenhuma `AuthorizationPolicy`. O pod `search` comprometido chama `POST /charges` em `payment`. O que acontece?

- A. A chamada é aceita: `search` tem uma identidade válida no mesh, e sem uma política de autorização todo workload autenticado é permitido
- B. A chamada é rejeitada, porque o mTLS só permite serviços conhecidos
- C. A chamada é rejeitada, porque o modo STRICT bloqueia todo o tráfego leste–oeste
- D. A chamada só é aceita se `search` tiver um JWT

??? success "Resposta"
    **A — mTLS autentica; não autoriza.**

    O modo STRICT garante que o canal é criptografado e que os dois lados têm certificados válidos do mesh — e `search` também tem um. Decidir *quem pode chamar o quê* exige uma `AuthorizationPolicy` (por exemplo, só `sa/order` pode fazer `POST /charges`). Assim que um workload tem uma política `ALLOW`, tudo o que não casa com ela é negado.

---

**Q10.** Qual afirmação compara melhor os planos de dados **sidecar** e **ambient** de um service mesh?

- A. O ambient injeta dois proxies em cada pod em vez de um
- B. O sidecar roda no kernel com eBPF; o ambient usa Envoy
- C. São idênticos, a não ser pelo nome
- D. O sidecar coloca um proxy L7 completo em cada pod; o ambient usa um ztunnel por nó para L4 (mTLS, identidade) e implanta proxies waypoint L7 só onde necessário

??? success "Resposta"
    **D.**

    Sidecars dão recursos L7 completos em todo lugar, a um custo que cresce com o número de pods (memória, CPU, reinícios nas atualizações). O ambient divide o mesh: o ztunnel de cada nó cuida do mTLS e da política L4 de todos os seus pods; um waypoint (Envoy) é implantado por namespace ou serviço só quando recursos L7 — roteamento HTTP, retries, políticas por caminho — são necessários.

---

**Q11.** `order` usa Resilience4j com 3 tentativas nas chamadas a `payment`, e o `VirtualService` do mesh acrescenta `retries.attempts: 2` (ou seja, até 3 tentativas por chamada). Durante uma lentidão de `payment`, quantas requisições um clique do usuário pode gerar em `payment`, e qual é a lição?

- A. 3 — o mesh ignora os retries da aplicação
- B. 5 — os retries se somam
- C. 9 — os retries se multiplicam entre camadas; faça retry em uma só camada, e só de operações idempotentes
- D. 1 — os retries são desligados durante lentidões

??? success "Resposta"
    **C — 3 × 3 = 9.**

    Cada uma das 3 tentativas da aplicação passa pelo proxy, que pode tentar até 3 vezes. Retries em várias camadas se multiplicam e criam tempestades de retries exatamente quando a dependência está mais fraca. Escolha uma camada, acrescente um orçamento de retries e backoff, e só repita chamadas não idempotentes (`POST /charges`) com uma chave de idempotência.

---

## Identidade

**Q12.** Qual fluxo do OAuth 2.1 o **app mobile** do BoxOffice deve usar para autenticar os usuários?

- A. Resource Owner Password Credentials: o app coleta e-mail e senha e os envia para `/token`
- B. Implicit: o token volta na URL de redirecionamento
- C. Client Credentials com um client secret embutido no app
- D. Authorization Code com PKCE, pelo navegador do sistema

??? success "Resposta"
    **D — Authorization Code + PKCE.**

    O app mobile é um **cliente público**: qualquer coisa embutida nele pode ser extraída, então um client secret não protege nada (C). ROPC (A) e Implicit (B) foram removidos no OAuth 2.1. Com Authorization Code + PKCE, o usuário se autentica no navegador do sistema, no authorization server, o app nunca vê a senha e o código interceptado é inútil sem o `code_verifier`.

---

**Q13.** Access tokens vivem 15 minutos e são validados **localmente** no gateway com o JWKS. Um refresh token é revogado às 14:05; o último access token foi emitido às 13:58. Até quando um ladrão com esse access token consegue chamar a API, e como encurtar essa janela?

- A. Até as 14:05 — revogar o refresh token invalida os access tokens
- B. Até as 14:13 — a validação local aceita o token até `exp`; encurte o tempo de vida do access token, ou use introspecção / uma denylist de `jti` para chamadas sensíveis
- C. Até 13:58 + 24 h
- D. Para sempre, até a chave de assinatura ser rotacionada

??? success "Resposta"
    **B — Até as 14:13.**

    13:58 + 15 min = 14:13. Um JWT autocontido validado localmente não pode ser "desemitido": o gateway não tem como saber que ele foi revogado. A janela de exposição é de até um tempo de vida de access token. Opções: tokens mais curtos (mais renovações), introspecção (uma chamada por requisição, revogação imediata), uma denylist de ids de token, ou tokens vinculados ao remetente (DPoP), para que um token roubado sozinho seja inútil.

---

## Zero Trust, segredos e cadeia de suprimentos

**Q14.** A chave da API de pagamentos está em um Secret do Kubernetes criado a partir de um manifesto versionado no repositório Git. Qual afirmação está correta?

- A. É seguro, porque Secrets do Kubernetes são criptografados com AES
- B. É seguro se o repositório for privado
- C. Base64 é codificação, não criptografia: qualquer um com acesso ao repositório (e a todo o seu histórico) tem a chave; ela precisa ser rotacionada e movida para um gerenciador de segredos (sincronizado, por exemplo, pelo External Secrets), com acesso restrito ao serviço `payment`
- D. É seguro, desde que o pod a leia de um arquivo e não de uma variável de ambiente

??? success "Resposta"
    **C.**

    Qualquer um consegue fazer `base64 -d` no valor. O histórico do Git o guarda para sempre, em todo clone e fork, então a chave precisa ser **rotacionada** — apagar o arquivo não adianta. A fonte da verdade deve ser um gerenciador de segredos ou o Vault, com IAM restringindo a leitura ao workload `payment` e um log de auditoria; a rotação usa duas chaves ativas para evitar indisponibilidade.

---

**Q15.** O pipeline de CI assina toda imagem com o cosign, mas o cluster não tem nenhuma política de admissão que verifique assinaturas. Um atacante com permissão de push no registry substitui a tag `order:1.4.2` por uma imagem maliciosa. O que acontece?

- A. A imagem maliciosa roda: assinar não protege nada se algo não verificar a assinatura (e o assinante esperado) no momento do deploy; além disso, fixe as imagens por digest
- B. O pod não sobe, porque as assinaturas do cosign são verificadas pelo runtime de containers
- C. O Kubernetes rejeita a mudança de tag automaticamente
- D. O SBOM bloqueia a imagem

??? success "Resposta"
    **A — Assinar *e* verificar.**

    Assinaturas só são úteis se um admission controller (Kyverno, Sigstore policy-controller) rejeitar imagens que não foram assinadas pela identidade esperada — aqui, o workflow de release do repositório do curso. Fixar por digest (`image@sha256:…`) também impede que uma tag movida mude o que roda. O SBOM descreve o conteúdo; sozinho, ele não bloqueia nada.
