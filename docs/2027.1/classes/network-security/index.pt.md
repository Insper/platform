
O BoxOffice sai do laptop e vai para produção na nuvem. Em um mês, quatro histórias chegam à mesa do time. O laptop de um prestador de serviço é roubado, e nele há um arquivo `.env` com a **chave de API do provedor de pagamentos**. O novo **app mobile** precisa de login, e alguém propõe "é só guardar a senha no app". Às 10:00 do dia em que um show de estádio abre as vendas, **bots** pegam 30% das reservas de assento no primeiro minuto e revendem os ingressos pelo triplo do preço. E uma biblioteca vulnerável no serviço `search` permite que um atacante execute código dentro de um pod — de onde, na configuração padrão, todos os outros serviços, o banco de dados e a Internet estão a uma conexão de distância.

Nenhum desses casos é um bug em uma linha de código. São problemas de **projeto**: onde ficam as fronteiras de rede, quem pode falar com quem, como as identidades são provadas, onde os segredos vivem e com que rapidez podem ser revogados. Esta aula trata segurança e redes do jeito que o resto do curso trata escalabilidade — como **decisões de arquitetura com trade-offs**, tomadas de propósito, desenhadas no diagrama e defendidas em uma entrevista.

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Construir** um modelo de ameaças de um fluxo do BoxOffice com STRIDE e **mapear** cada ameaça para um controle e para o OWASP API Security Top 10.
    - **Projetar** uma rede em nuvem para o BoxOffice: VPC, plano de CIDR, sub-redes públicas/privadas/isoladas em várias zonas, tabelas de rotas, NAT gateway, security groups e conectividade privada.
    - **Explicar** o que um service mesh acrescenta (mTLS, políticas de tráfego, telemetria), **comparar** planos de dados sidecar, ambient e eBPF, e **escrever** uma política de autorização entre dois serviços.
    - **Escolher** o fluxo OAuth 2.1 / OpenID Connect certo para cada cliente (app mobile, aplicação web, job em lote) e **validar** um JWT corretamente no gateway.
    - **Aplicar** Zero Trust ao tráfego entre serviços, **projetar** o ciclo de vida de um segredo (a chave da API de pagamentos) e **proteger** a cadeia de suprimentos de software com SBOMs e imagens assinadas.

## Roteiro

1. **Esta visão geral** — segurança como projeto: modelagem de ameaças com STRIDE, defesa em profundidade e o OWASP API Security Top 10 aplicado ao BoxOffice.
2. [Redes em nuvem](cloud-network/index.md) — VPC, sub-redes, tabelas de rotas, Internet e NAT gateways, security groups vs NACLs, endpoints privados, VPN e links dedicados.
3. [Service mesh](service-mesh/index.md) — plano de dados e plano de controle, sidecar vs ambient vs eBPF, mTLS, políticas de autorização e de tráfego.
4. [Identidade: OAuth 2.1, OIDC e JWT](identity/index.md) — sessões vs tokens, Authorization Code + PKCE para o app mobile, OpenID Connect, validação de tokens, modelos de autorização.
5. [Zero Trust, segredos e cadeia de suprimentos](zero-trust/index.md) — nunca confiar na rede, identidade de workloads, gestão de segredos, SBOM, assinatura de imagens e SLSA.
6. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/network-security.html" title="Slides: redes e segurança" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/network-security.html){:target="_blank"}

---

## Segurança é uma propriedade do projeto

Um erro comum é tratar segurança como uma checklist aplicada no fim ("coloca HTTPS e uma tela de login"). Nessa hora as decisões caras já foram tomadas: o banco de dados está numa sub-rede com rota para a Internet, todos os serviços compartilham uma senha de banco, o gateway é o único lugar que verifica alguma coisa. Mudar isso depois significa refazer a arquitetura.

A alternativa é fazer as perguntas de segurança **enquanto se desenha a arquitetura**, com a mesma seriedade de "quantas QPS?". Três ideias organizam toda a aula:

| Ideia | Pergunta que responde | Onde na aula |
|---|---|---|
| **Modelagem de ameaças** | O que pode dar errado, e onde? | esta página |
| **Defesa em profundidade** | Se um controle falhar, o que segura o atacante em seguida? | esta página, todas as subpáginas |
| **Menor privilégio / Zero Trust** | Qual é o *mínimo* de que cada usuário, serviço e caminho de rede precisa? | [Zero Trust](zero-trust/index.md), [Service mesh](service-mesh/index.md) |

Dois termos usados ao longo da aula:

- **Superfície de ataque** (*attack surface*) — a soma de todos os pontos por onde um atacante pode tentar entrar ou extrair dados: endpoints públicos, portas abertas, dependências, pessoas com acesso.
- **Raio de impacto** (*blast radius*) — o que um atacante alcança *depois* que um componente é comprometido. Um bom projeto o mantém pequeno.

---

## Modelagem de ameaças com STRIDE { #stride }

**Modelagem de ameaças** (*threat modeling*) é uma conversa estruturada sobre um projeto: desenhar como os dados fluem, marcar onde o nível de confiança muda e perguntar sistematicamente o que pode dar errado em cada elemento[^1]. Adam Shostack a resume em quatro perguntas[^2]:

1. *Em que estamos trabalhando?* — desenhe um **diagrama de fluxo de dados** (DFD).
2. *O que pode dar errado?* — enumere ameaças, por exemplo com STRIDE.
3. *O que vamos fazer a respeito?* — escolha um controle para cada ameaça (mitigar, aceitar, transferir, eliminar).
4. *Fizemos um bom trabalho?* — revise, teste, repita quando o projeto mudar.

### Passo 1 — o diagrama de fluxo de dados do checkout

Uma **fronteira de confiança** (*trust boundary*) é uma linha onde os dados passam entre componentes com níveis diferentes de confiança: a Internet e a nossa borda, o nosso cluster e o provedor de pagamentos, um serviço e o seu banco. As ameaças se concentram nas fronteiras.

``` mermaid-sim
flowchart LR
    subgraph internet ["Internet (não confiável)"]
        M(["App mobile"])
        B(["Bot"])
    end
    subgraph edge ["Borda (sub-rede pública)"]
        W["WAF + API gateway"]
    end
    subgraph cluster ["Cluster BoxOffice (sub-redes privadas)"]
        O["order"]
        I["inventory"]
        P["payment"]
        A["auth"]
    end
    subgraph data ["Dados (sub-redes isoladas)"]
        DB[("PostgreSQL")]
    end
    subgraph ext ["Provedor de pagamentos (terceiro)"]
        PSP["API do PSP"]
    end
    M -->|"POST /orders + token"| W
    B -.->|"POST /holds × 10 000"| W
    W --> O
    O --> I
    I --> DB
    O --> P
    P -->|"chave de API, via NAT"| PSP
    PSP -.->|"webhook: pagamento capturado"| W
    M -->|"login"| A
```

Cinco fronteiras de confiança são atravessadas em um único checkout: Internet → borda, borda → cluster, serviço → banco, cluster → provedor e provedor → cluster (o webhook). Cada seta é uma pergunta: *quem está chamando, como sabemos, e o que ele pode fazer?*

### Passo 2 — STRIDE

**STRIDE** é um mnemônico criado na Microsoft para seis categorias de ameaça, cada uma a violação de uma propriedade de segurança[^1]:

| Ameaça | Propriedade violada | Exemplo no BoxOffice | Controle | Onde |
|---|---|---|---|---|
| **S**poofing (falsificação de identidade) | Autenticação | um atacante chama `payment` fingindo ser `order`; um webhook forjado diz "pagamento capturado" | tokens OAuth, mTLS entre serviços, assinatura do webhook (HMAC) | [Identidade](identity/index.md), [Service mesh](service-mesh/index.md) |
| **T**ampering (adulteração) | Integridade | o preço é alterado no corpo da requisição; uma imagem maliciosa é enviada ao registry | preço calculado no servidor, TLS, imagens assinadas | [Zero Trust](zero-trust/index.md#supply-chain-security) |
| **R**epudiation (repúdio) | Não repúdio | um cliente diz "nunca comprei esses ingressos" e não conseguimos provar o contrário | log de auditoria com id do usuário + trace id, eventos assinados | [Observabilidade](../observability/index.md) |
| **I**nformation disclosure (vazamento de informação) | Confidencialidade | `GET /orders/1042` devolve o pedido de outro usuário; a chave de API vaza em um log | autorização por objeto, gerenciador de segredos, mascaramento de logs | [Identidade](identity/index.md#authorization-models), [Zero Trust](zero-trust/index.md#secrets-management) |
| **D**enial of service (negação de serviço) | Disponibilidade | bots abrem 100 000 reservas de assento e ninguém mais consegue comprar | WAF, rate limiting, sala de espera, TTL da reserva | [Borda](../edge/index.md) |
| **E**levation of privilege (elevação de privilégio) | Autorização | um usuário comum chama `POST /admin/events`; o pod `search` comprometido alcança o banco | autorização por função, NetworkPolicy, menor privilégio | [Zero Trust](zero-trust/index.md), [Redes em nuvem](cloud-network/index.md) |

STRIDE é aplicado **a cada elemento do DFD**: processos estão expostos às seis categorias; repositórios de dados, principalmente a adulteração, vazamento de informação e negação de serviço; fluxos de dados, a adulteração, vazamento e DoS; entidades externas, a falsificação e repúdio[^2].

### Passo 3 — avaliar o risco e decidir

Nem toda ameaça merece o mesmo esforço. Uma prática simples é estimar **probabilidade × impacto** (baixo / médio / alto) e agir a partir do topo da lista. O resultado de uma sessão de modelagem de ameaças é uma tabela curta de *ameaça → decisão → responsável*, guardada junto com o documento de projeto e revisitada quando o projeto muda.

!!! example "BoxOffice — três decisões de uma sessão"

    | Ameaça | Probabilidade × impacto | Decisão |
    |---|---|---|
    | Bots acumulam reservas de assento às 10:00 | alta × alto | **Mitigar**: regras de bot no WAF + rate limits por conta e por IP + sala de espera + TTL de 10 minutos na reserva |
    | Webhook "pagamento capturado" forjado | média × alto | **Mitigar**: verificar a assinatura HMAC do provedor e consultar de novo o status do pagamento antes de emitir ingressos |
    | Indisponibilidade do provedor não vaza dados, mas bloqueia vendas | média × médio | **Aceitar** por enquanto; revisitar com um segundo provedor no próximo trimestre |

??? question "Pense antes: onde está o ativo mais valioso do BoxOffice?"

    Não é o banco de eventos — isso é informação pública. Os ativos mais valiosos são a **chave de API do provedor de pagamentos** (quem a tem pode emitir estornos ou cobranças), os **dados pessoais dos clientes** (regulados pela LGPD, a Lei Geral de Proteção de Dados) e o **próprio inventário de assentos** durante uma venda relâmpago (um ativo de negócio que os bots tentam roubar). Os controles devem ser mais fortes em volta deles.

---

## Defesa em profundidade { #defense-in-depth }

Nenhum controle é perfeito: regras de WAF têm lacunas, tokens são roubados, uma biblioteca sai com um bug de execução remota de código. **Defesa em profundidade** empilha camadas independentes, de modo que um atacante que vence uma ainda enfrenta a próxima. As camadas do BoxOffice, de fora para dentro:

``` mermaid-sim
flowchart LR
    U(["Cliente"]) -->|"1 · TLS, WAF, rate limit"| GW["API gateway"]
    GW -->|"2 · valida token (OAuth/OIDC)"| O["order"]
    O -->|"3 · verifica dono (authZ)"| O
    O -->|"4 · mTLS + política do mesh"| P["payment"]
    P -->|"5 · sub-rede + security group"| DB[("PostgreSQL")]
    P -->|"6 · segredo de vida curta"| PSP["PSP"]
```

| # | Camada | Principais ameaças | Controles | Subpágina |
|---|---|---|---|---|
| 1 | Borda | DDoS, bots, injeção, escuta | TLS, WAF, rate limiting, sala de espera | [Borda](../edge/index.md) |
| 2 | Identidade | credenciais roubadas ou forjadas | OAuth 2.1 / OIDC, tokens de vida curta, MFA, passkeys | [Identidade](identity/index.md) |
| 3 | Autorização da requisição | usuário lê dados de outra pessoa | dono, papéis e escopos verificados em cada serviço | [Identidade](identity/index.md#authorization-models) |
| 4 | Serviço a serviço | movimento lateral, chamadores falsificados | mTLS, política de autorização do mesh | [Service mesh](service-mesh/index.md) |
| 5 | Rede | alcançar o que deveria ser inalcançável | sub-redes privadas, security groups, NetworkPolicy, banco nunca público | [Redes em nuvem](cloud-network/index.md) |
| 6 | Dados e segredos | chaves e senhas vazadas | gerenciador de segredos, rotação, criptografia em repouso (KMS) | [Zero Trust](zero-trust/index.md#secrets-management) |
| 7 | Cadeia de suprimentos | dependência ou imagem maliciosa | SBOM, varredura de vulnerabilidades, imagens assinadas, proveniência | [Zero Trust](zero-trust/index.md#supply-chain-security) |

As camadas são **independentes**: o security group do banco não se importa se o token era válido, e a política do mesh não se importa se o WAF foi contornado. Essa independência é o ponto.

---

## OWASP API Security Top 10 (2023) { #owasp-api-top-10 }

A **OWASP** (Open Worldwide Application Security Project) publica uma lista dos riscos mais críticos de APIs[^3]. É a melhor checklist para levar a uma revisão de projeto, porque quase todo item é uma decisão de *arquitetura*, não um erro de digitação. Aplicada ao BoxOffice:

| # | Risco | Exemplo no BoxOffice | Controle principal |
|---|---|---|---|
| API1 | **Broken Object Level Authorization** (BOLA) | `GET /orders/1042` devolve o pedido 1042 a *qualquer* usuário logado | cada serviço verifica se o objeto pertence a quem chama |
| API2 | Broken Authentication | tokens sem expiração; endpoint de login sem proteção contra força bruta | provedor OIDC padrão, tokens curtos, login com rate limit, MFA |
| API3 | Broken Object Property Level Authorization | `PATCH /orders/1042 {"status":"PAID"}` aceito; `GET /users/me` devolve o hash da senha | DTOs explícitos de entrada/saída, nunca ligar a requisição direto à entidade |
| API4 | Unrestricted Resource Consumption | uma conta abre 5 000 reservas de assento; `GET /events?size=1000000` | rate limits, cotas, limite de paginação, TTL da reserva |
| API5 | Broken Function Level Authorization | um cliente chama `POST /admin/events` | verificação de papel por endpoint, API de admin em rota/rede separada |
| API6 | Unrestricted Access to Sensitive Business Flows | bots cambistas compram o estádio inteiro em segundos | detecção de bots, limite de compra por conta, sala de espera, CAPTCHA/atestação do dispositivo |
| API7 | Server-Side Request Forgery (SSRF) | "importar o pôster do evento a partir de uma URL" busca `http://169.254.169.254/` (metadados da nuvem) | lista de destinos permitidos, bloquear faixas internas, controle de egress |
| API8 | Security Misconfiguration | endpoints de debug em produção; CORS permissivo; stack traces detalhados | padrões endurecidos, revisão de configuração no CI |
| API9 | Improper Inventory Management | um `/v1/orders` antigo, sem as novas verificações, ainda está no ar | inventário de APIs, depreciar e remover versões antigas |
| API10 | Unsafe Consumption of APIs | confiar cegamente no corpo do webhook do provedor | verificar assinaturas, validar e consultar de novo, timeouts |

!!! warning "BOLA é o número um por um motivo"
    O gateway consegue dizer "este é o usuário 42". Só o serviço `order` sabe se o pedido 1042 pertence ao usuário 42. A autorização por objeto **não pode** ser centralizada na borda; ela vive no código que é dono dos dados. Teste explicitamente: "o usuário A pede o pedido do usuário B → `404` ou `403`".

**Experimente.** Abra o cenário `flash-sale` e rode o perfil `spike`: observe como a rajada das 10:00 atinge o banco de inventário. Agora imagine que 30% desse tráfego são bots (API6): qual componente você adicionaria primeiro, e onde — WAF na borda, rate limiting no gateway ou a fila da sala de espera? Use o [playground completo](../../../playground/index.md) para adicionar os componentes e comparar o p99 e as requisições rejeitadas.

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-height="520" data-profile="spike"></div>

## O mapa de conceitos de rede e segurança { #concept-map }

Segurança não é uma caixa no diagrama: cada salto de uma requisição responde a uma **pergunta de confiança** diferente. O mapa liga cada **componente da paleta** (verde) aos **conceitos** que ele aplica (azul) e à subpágina que os ensina; os nós azuis são as camadas da [defesa em profundidade](#defense-in-depth):

``` mermaid
flowchart LR
    client["client · mobile"]:::comp -->|"login"| auth["auth"]:::comp
    client --> waf["waf"]:::comp
    waf --> apigw["apigw"]:::comp
    apigw --> mesh["mesh<br/>(order, payment, …)"]:::comp
    mesh -->|"saída via nat"| pay["payment (PSP)"]:::comp
    vpc["vpc · subnet ·<br/>nat · vpn"]:::comp -.->|"contém"| mesh
    waf -.- c1["bots, rate limits,<br/>OWASP API4 / API6"]:::tech
    auth -.- c2["OAuth 2.1 + PKCE, OIDC,<br/>RBAC / ABAC / ReBAC"]:::tech
    apigw -.- c3["validação de JWT (JWKS),<br/>remover headers de identidade"]:::tech
    mesh -.- c4["mTLS, identidade SPIFFE,<br/>política de authz, NetworkPolicy"]:::tech
    vpc -.- c5["plano de CIDR, sub-redes públicas /<br/>privadas / isoladas, SGs"]:::tech
    pay -.- c6["gerenciador de segredos,<br/>rotação com duas chaves"]:::tech
    c4 -.- d1["Zero Trust: suponha a invasão,<br/>negar por padrão"]
    c1 -.- d2["STRIDE, OWASP API Top 10<br/>(esta visão geral)"]
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`waf`](../../reference/components/edge/index.md#waf) | Esta requisição é um ataque ou um bot? | OWASP API4/API6, regras contra bots, rate limits, sala de espera | [OWASP API Top 10](#owasp-api-top-10), [Borda — segurança](../edge/index.md#edge-security) | `flash-sale`, `rate-limiter` |
| [`auth`](../../reference/components/compute/index.md#auth) | *Quem* é o usuário, e qual cliente pede? | OAuth 2.1, Authorization Code + PKCE, OIDC, Client Credentials, Token Exchange | [Identidade](identity/index.md#oauth) | `flash-sale` (estenda-o), `blank` |
| [`apigw`](../../reference/components/edge/index.md#apigw) | A requisição traz um token válido? | validação de JWT (JWKS, `iss`, `aud`, `exp`), remoção de headers | [Identidade — gateway](identity/index.md#gateway-validation) | `rate-limiter`, `flash-sale` |
| [`vpc`](../../reference/components/network/index.md#vpc) · [`subnet`](../../reference/components/network/index.md#subnet) | *Onde* vive cada componente, e o que o alcança? | plano de CIDR, sub-redes públicas/privadas/isoladas, tabelas de rotas, SGs/NACLs | [Redes na nuvem](cloud-network/index.md#subnets) | `multi-region`, `scale-out` |
| [`nat`](../../reference/components/network/index.md#nat) | Como os serviços privados chamam *para fora*? | NAT por AZ, IP de saída estável, VPC endpoints | [Redes na nuvem](cloud-network/index.md#subnets) | `payment-system` |
| [`vpn`](../../reference/components/network/index.md#vpn) | Como outras redes e pessoas *entram*? | peering, transit, PrivateLink, VPN, session manager | [Redes na nuvem](cloud-network/index.md#private-connectivity) | `multi-region` |
| [`mesh`](../../reference/components/network/index.md#mesh) | *Qual serviço* pode chamar qual? | mTLS, SPIFFE, política de autorização, política de tráfego, NetworkPolicy | [Service mesh](service-mesh/index.md) | `cascading-failure`, `retry-storm` |
| [`payment`](../../reference/components/external/index.md#payment) | Quem guarda a chave que movimenta dinheiro? | gerenciador de segredos, rotação com duas chaves, identidade de workload, HMAC de webhook | [Zero Trust — segredos](zero-trust/index.md#secrets-management) | `payment-system` |
| *(todos eles)* | Podemos confiar no código que roda? | Zero Trust, SBOM, scanning, assinatura, SLSA | [Zero Trust — cadeia de suprimentos](zero-trust/index.md#supply-chain-security) | `ai-assistant` |

!!! tip "Na entrevista"
    Raramente vão pedir "faça uma modelagem de ameaças". Mas um candidato forte **traz segurança por conta própria, em uma ou duas frases, na hora certa**: "o banco fica numa sub-rede isolada, sem rota para a Internet; os serviços conversam por mTLS; o app mobile usa Authorization Code com PKCE; a chave de pagamento fica num gerenciador de segredos e é rotacionada; e, na borda, WAF mais rate limits por conta protegem o fluxo de abertura de vendas contra bots." Depois siga em frente — a não ser que o entrevistador queira aprofundar. Mencione **BOLA** sempre que projetar um endpoint com um id no caminho.

!!! warning "Armadilhas comuns"
    - **Segurança só no gateway** — qualquer serviço alcançável sem passar por ele (um `NodePort`, uma porta de debug, um segundo Ingress) contorna tudo.
    - **Confiar na rede interna** — "está dentro da VPC, então é seguro" é como um pod comprometido vira um vazamento completo.
    - **Fazer o seu próprio** algoritmo criptográfico, formato de token ou protocolo de login — use padrões e bibliotecas consolidadas.
    - **Modelar ameaças uma vez e nunca mais** — o modelo fica velho no dia em que um novo fluxo (webhooks, um assistente de IA com ferramentas) é adicionado.

---

## Relacionados

- Componentes no [catálogo](../../reference/components/network/index.md#vpc): VPC, Subnet, NAT Gateway, VPN, Service Mesh; além de [Auth Service](../../reference/components/compute/index.md#auth) e [WAF](../../reference/components/edge/index.md#waf).
- Aulas: [Tráfego e borda](../edge/index.md) (WAF, API gateway, rate limiting), [Cloud-native](../cloud-native/index.md) (Kubernetes, CI/CD), [Observabilidade](../observability/index.md) (trilhas de auditoria, alertas de segurança).
- Hands-on: [4 — Gateway e identidade](../../hands-on/4/index.md), [10 — Kubernetes](../../hands-on/10/index.md), [11 — Entrega](../../hands-on/11/index.md) (varredura de imagens, SBOM, assinatura).
- Estudo de caso: [Sistema de pagamentos](../case-studies/payment-system/index.md). Exercício: [Design doc](../../exercises/design-doc/index.md). Projeto: [projeto em equipe](../../exercises/project/index.md).

## Principais conclusões

- Segurança é uma **propriedade do projeto**: decida fronteiras, identidades e privilégios enquanto desenha a arquitetura.
- **Modelagem de ameaças** = desenhar o fluxo de dados, marcar as fronteiras de confiança, rodar **STRIDE** por elemento, decidir e registrar.
- **Defesa em profundidade** empilha camadas independentes: borda, identidade, autorização da requisição, serviço a serviço, rede, segredos, cadeia de suprimentos.
- O **OWASP API Top 10** é uma checklist de revisão de projeto; **BOLA** é o número um e só pode ser corrigido no serviço que é dono dos dados.
- Na entrevista, mencione segurança de forma breve e concreta no momento certo — sub-redes privadas, mTLS, PKCE, gerenciador de segredos, rate limits.

---

[^1]: KOHNFELDER, L.; GARG, P. [The Threats to Our Products](https://www.microsoft.com/en-us/security/blog/2009/08/27/the-threats-to-our-products/){target="_blank"}. Microsoft, 1999 (republicado por Adam Shostack no blog Microsoft Security, 2009) — origem do STRIDE. Veja também a [Threat Modeling Tool — STRIDE](https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats){target="_blank"} da Microsoft.
[^2]: SHOSTACK, A. *Threat Modeling: Designing for Security*. Wiley, 2014. Veja também o [Threat Modeling Manifesto](https://www.threatmodelingmanifesto.org/){target="_blank"}.
[^3]: OWASP. [API Security Top 10 — 2023](https://owasp.org/API-Security/editions/2023/en/0x11-t10/){target="_blank"}.
