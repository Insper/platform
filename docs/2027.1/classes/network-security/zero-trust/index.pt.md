
Uma biblioteca vulnerável de processamento de imagens permite que um atacante execute código dentro de um pod `search`. Agora repita o filme na configuração padrão. Desse pod, o atacante chama `order` com o cabeçalho `X-Account-Id: acc-42` e lê os pedidos da Ana, porque "só o gateway alcança `order`". Ele lê as variáveis de ambiente e encontra `DATABASE_URL` com a única senha que todos os serviços compartilham. Encontra `PSP_API_KEY`, porque a chave de pagamento foi colocada em um ConfigMap "temporariamente". Abre uma conexão com `https://attacker.example` e envia tudo, porque a sub-rede privada tem uma rota para o NAT e nada restringe a saída. Cada passo foi possível porque algo **confiou na rede**.

Esta página trata da arquitetura que remove essa confiança — **Zero Trust** — e de dois lugares onde a confiança se esconde em todo sistema: os **segredos** e a **cadeia de suprimentos de software**.

---

## Do perímetro ao Zero Trust

O **modelo de perímetro** ("castelo e fosso") protege a borda — firewall, VPN — e confia em tudo o que está dentro. Quando um atacante entra, por um laptop roubado, uma senha capturada por phishing ou uma dependência vulnerável, ele passa de máquina em máquina: **movimento lateral**.

O **Zero Trust** remove a ideia de rede confiável. O lema é **"nunca confie, sempre verifique"**: toda requisição — da Internet, do escritório, do pod ao lado — é autenticada, autorizada e criptografada por si só[^1]. O Google construiu a sua rede corporativa assim no projeto BeyondCorp, a partir de 2011[^2]; o NIST padronizou a arquitetura na SP 800-207[^1].

``` mermaid-sim
flowchart LR
    subgraph perimeter ["Modelo de perímetro"]
        fw["Firewall / VPN"] -->|"dentro = confiável"| int["search, order, payment, banco<br/>(confiam uns nos outros)"]
    end
    subgraph zt ["Modelo Zero Trust"]
        any["Qualquer requisição<br/>(usuário ou workload)"] -->|"identidade + contexto"| pep["Policy Enforcement Point<br/>(gateway, proxy do mesh)"]
        pep -->|"pergunta"| pdp["Policy Decision Point<br/>(políticas, identidade, dispositivo, risco)"]
        pdp -->|"permite, menor privilégio"| res["Recurso"]
        pdp -->|"nega"| rej["Rejeitada + registrada"]
    end
```

O NIST dá nome às peças: um **Policy Enforcement Point (PEP)** fica no caminho de toda requisição e a bloqueia ou encaminha; um **Policy Decision Point (PDP)** decide a partir da identidade e do contexto. No BoxOffice, o **API gateway** é o PEP para usuários, e o **proxy do mesh** ao lado de cada serviço é o PEP para workloads ([Service mesh](../service-mesh/index.md)).

### Princípios

| Princípio | O que significa | Mecanismos no BoxOffice |
|---|---|---|
| **Verificar explicitamente** | todo usuário *e todo workload* prova quem é em toda requisição | tokens OIDC, mTLS com identidades SPIFFE, webhooks assinados |
| **Menor privilégio** | o mínimo de acesso, pelo mínimo de tempo | escopos estreitos, um usuário de banco por serviço, credenciais de vida curta, allow-lists de saída |
| **Assumir a violação** | projetar como se o atacante já estivesse dentro; limitar o raio de impacto | NetworkPolicy com negação padrão, sub-redes isoladas, segredos por serviço, logs de auditoria |
| **Avaliação contínua** | a confiança é reavaliada, não concedida uma vez | tokens de vida curta, reautenticação para ações sensíveis, alertas de anomalia |

### O pod `search` comprometido, de novo

| Passo do atacante | Modelo de perímetro | Controle Zero Trust | Onde |
|---|---|---|---|
| Chamar `order` com um `X-Account-Id` forjado | aceito — "só chamadores internos" | `order` aceita chamadas só da identidade de mesh do gateway; cabeçalho removido na borda | [Service mesh](../service-mesh/index.md), [Identidade](../identity/index.md) |
| Conectar ao PostgreSQL com a senha compartilhada | funciona | `search` não tem rota/SG/NetworkPolicy até o banco, nem credencial de banco alguma | [Redes em nuvem](../cloud-network/index.md) |
| Ler `PSP_API_KEY` do ambiente | está lá | a chave só existe nos pods de `payment`, buscada em um gerenciador de segredos | [Segredos](#secrets-management) |
| Exfiltrar para a Internet | rota pelo NAT, sem regras de saída | saída negada por padrão; só `payment` alcança o provedor | [Service mesh](../service-mesh/index.md) |
| Continuar escondido | ninguém olha o tráfego interno | chamadas negadas são registradas e geram alerta | [Observabilidade](../../observability/index.md) |

O ataque ainda *começou* — o Zero Trust não impede o primeiro comprometimento. Ele faz do pod comprometido um **beco sem saída**.

---

## Identidade de workload: chega de chaves de vida longa { #workload-identity }

O Zero Trust exige que todo workload tenha uma identidade que consiga provar **sem um segredo estático**. Três formas comuns:

| Workload | Mecanismo de identidade | O que substitui |
|---|---|---|
| Pod → pod | SPIFFE ID em um certificado mTLS emitido pelo mesh ou pelo SPIRE, rotacionado de hora em hora ou diariamente | allow-lists de IP, tokens de API compartilhados |
| Pod → API da nuvem (S3, Secrets Manager, KMS) | a service account do Kubernetes federada a um papel na nuvem: EKS Pod Identity / IRSA, GKE Workload Identity Federation, Azure Workload Identity | chaves de acesso em variáveis de ambiente |
| Pipeline de CI → nuvem | o **token OIDC** do sistema de CI trocado por credenciais de nuvem de vida curta | chaves de acesso da nuvem guardadas como segredos do CI |

A terceira é uma mudança pequena com grande efeito: o GitHub Actions consegue pedir um token OIDC que diz "sou o workflow `release.yaml` deste repositório, no branch `main`", e a nuvem confia nessa afirmação para um papel válido só durante o job[^3]:

```yaml
permissions:
  contents: read
  id-token: write          # allow the job to request an OIDC token
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@v4
        with:
          role-to-assume: arn:aws:iam::123456789012:role/boxoffice-deploy
          aws-region: sa-east-1
      - run: aws eks update-kubeconfig --name boxoffice-prod
```

Nenhuma chave da AWS fica guardada no GitHub; a política de confiança do papel aceita só tokens cujo `sub` case com `repo:<org>/<repo>:ref:refs/heads/main`. Um fork do repositório ou outro branch não consegue assumi-lo.

!!! note "Pessoas também são workloads"
    Para engenheiros, Zero Trust significa: single sign-on com MFA ou passkeys, verificação da postura do dispositivo e acesso por um proxy com reconhecimento de identidade ou um session manager, em vez de uma VPN que coloca o laptop "dentro" ([Redes em nuvem](../cloud-network/index.md)). Todo acesso é por aplicação e registrado.

---

## Gestão de segredos { #secrets-management }

Um **segredo** é qualquer valor que concede acesso: a chave de API do provedor de pagamentos, senhas de banco, a chave de assinatura do provedor de identidade, segredos HMAC de webhooks, tokens de registry. Segredos não devem viver onde as coisas são copiadas, versionadas ou registradas em log: código-fonte, imagens de container, ConfigMaps comuns, logs de CI.

!!! danger "Secrets do Kubernetes são base64, não criptografia"
    Um Secret do Kubernetes guarda valores *codificados* em base64. Qualquer um que consiga fazer `get` de Secrets no namespace — ou criar um pod que os monte — os lê com um comando:

    ```bash
    kubectl get secret psp-api-key -n boxoffice -o jsonpath='{.data.PSP_API_KEY}' | base64 -d
    ```

    Por padrão, eles também ficam sem criptografia no etcd. Higiene mínima: **criptografia em repouso** para o etcd (com um provedor KMS), **RBAC** restrito sobre Secrets e **nunca** versionar manifestos de Secret no Git sem criptografia[^4].

### Onde os segredos devem morar

| Abordagem | Prós | Contras |
|---|---|---|
| Só Secrets do Kubernetes | simples, nativo | base64; rotação e auditoria por sua conta |
| Criptografados no Git (Sealed Secrets, SOPS) | combina com GitOps, revisados em PRs | rotação continua manual; gestão da chave de selagem |
| **Gerenciador de segredos da nuvem** (AWS Secrets Manager, GCP Secret Manager, Azure Key Vault) | gerenciado, versionado, log de auditoria, ganchos de rotação, IAM por segredo | preso a uma nuvem; custo por segredo e por chamada |
| **HashiCorp Vault / OpenBao** | segredos dinâmicos, qualquer nuvem, políticas e auditoria finas | um sistema crítico e com estado para operar |

O **External Secrets Operator** (ESO) liga os dois mundos: a fonte da verdade é o gerenciador de segredos; o ESO sincroniza os valores em Secrets nativos que os pods leem como sempre.

```yaml
apiVersion: external-secrets.io/v1
kind: ExternalSecret
metadata:
  name: psp-api-key
  namespace: boxoffice
spec:
  refreshInterval: 1h
  secretStoreRef:
    kind: ClusterSecretStore
    name: aws-secrets-manager
  target:
    name: psp-api-key            # Kubernetes Secret created and kept in sync by ESO
  data:
    - secretKey: PSP_API_KEY
      remoteRef:
        key: prod/boxoffice/payment/psp-api-key
```

### A vida da chave da API de pagamentos

O provedor de pagamentos permite que um lojista tenha **duas chaves ativas** ao mesmo tempo — o truque padrão para rotacionar sem indisponibilidade. O ciclo de vida do segredo mais valioso do BoxOffice:

``` mermaid-sim
sequenceDiagram
    autonumber
    actor Ops as Plantão de pagamentos
    participant PSP as Provedor de pagamentos
    participant SM as Secrets Manager
    participant ESO as External Secrets Operator
    participant K8s as Secret psp-api-key
    participant Pay as pods de payment
    Ops->>PSP: cria a chave 2 (chave 1 ainda ativa)
    Ops->>SM: grava a chave 2 como nova versão de prod/boxoffice/payment/psp-api-key
    ESO->>SM: atualiza (a cada 1 h, ou forçado)
    SM-->>ESO: versão 2
    ESO->>K8s: atualiza o Secret
    K8s-->>Pay: arquivo montado muda → app recarrega (ou rolling restart)
    Pay->>PSP: cobranças agora assinadas com a chave 2
    Ops->>Ops: confirma nas métricas: zero chamadas com a chave 1 por 24 h
    Ops->>PSP: revoga a chave 1
```

Repare no que o projeto oferece: só a service account de `payment` pode ler esse segredo (IAM); toda leitura fica no log de auditoria; a chave nunca aparece no Git, em imagens ou em logs de CI; e, se ela vazar, o mesmo procedimento roda em minutos, não em dias.

!!! example "BoxOffice — runbook de chave vazada (versão curta)"

    1. **Revogue primeiro, investigue depois**: crie uma nova chave, faça o rollout (sequência acima), revogue a vazada.
    2. Procure no painel do provedor chamadas de IPs desconhecidos (o BoxOffice só chama a partir dos Elastic IPs dos seus NATs).
    3. Descubra como vazou (histórico do Git, logs, um laptop) e feche esse caminho.
    4. Escreva um postmortem sem culpados ([Observabilidade — resposta a incidentes](../../observability/incident-response/index.md)).

### Segredos dinâmicos

Melhor ainda que rotacionar um segredo compartilhado é não ter um. **Segredos dinâmicos** (o database engine do Vault, autenticação IAM em bancos da nuvem) criam uma **credencial única e de vida curta para cada solicitante**:

```bash
$ vault read database/creds/order
Key                Value
lease_id           database/creds/order/8sTt3lV0b2yL
lease_duration     1h
username           v-k8s-order-x7Qa2
password           A1a-4kd0s8f7GQpz
```

Cada pod de `order` recebe o seu próprio usuário de banco, que expira em uma hora. Uma credencial roubada de um pod para de funcionar sozinha, e os logs do banco mostram exatamente qual pod fez o quê.

### Criptografia em repouso com envelope encryption

Bancos de dados, object storage e backups são criptografados em repouso com **envelope encryption**: cada objeto é criptografado com uma **chave de dados**; a chave de dados, por sua vez, é criptografada com uma **chave de criptografia de chaves** que nunca sai de um **KMS** (Key Management Service) ou HSM (hardware security module).

``` mermaid
flowchart LR
    D["dados de order"] -->|"AES-256-GCM com a chave de dados"| E["texto cifrado"]
    DK["chave de dados (em claro, só em memória)"] -->|"cifrada pela API do KMS"| EDK["chave de dados cifrada<br/>(guardada ao lado do texto cifrado)"]
    KMS["chave-mestra do KMS<br/>(nunca sai do KMS/HSM)"] -.-> EDK
```

Rotacionar ou revogar a chave-mestra no KMS controla o acesso a todos os dados sem recriptografar terabytes; toda chamada de decriptação é autorizada pelo IAM e registrada.

### Mantenha segredos fora do Git

Faça a varredura antes que eles cheguem: um **hook de pre-commit** e um job de CI com um scanner de segredos (gitleaks, trufflehog, GitHub secret scanning com push protection) bloqueiam commits que parecem chaves. Se um segredo for versionado alguma vez, **rotacione-o** — apagar o commit não apaga clones, forks nem caches.

---

## Segurança da cadeia de suprimentos { #supply-chain-security }

A imagem de `order` do BoxOffice contém algumas centenas de bibliotecas escritas por desconhecidos, construídas por um sistema de CI, guardadas em um registry e baixadas pelo cluster. Cada passo é um caminho de ataque: uma dependência maliciosa ou comprometida (o backdoor do `xz-utils`, em 2024), uma vulnerável (Log4Shell, 2021), um sistema de build comprometido (SolarWinds, 2020), **typosquatting** (`spring-boot-strater`) e **dependency confusion** (um pacote público com o nome do seu pacote interno). A segurança da cadeia de suprimentos responde a três perguntas: *o que tem dentro?*, *está vulnerável?*, *veio do nosso pipeline, sem alterações?*

``` mermaid-sim
flowchart LR
    src["Código<br/>(PR revisado)"] --> build["Build no CI<br/>(runner isolado)"]
    build --> sbom["SBOM<br/>(syft → CycloneDX)"]
    build --> scan["Varredura<br/>(trivy / grype)"]
    scan -->|"sem CVEs críticas"| sign["Assinatura + proveniência<br/>(cosign keyless, SLSA)"]
    sbom --> sign
    sign --> reg[("Registry<br/>imagem@sha256 + atestações")]
    reg --> adm{"Política de admissão<br/>(Kyverno)"}
    adm -->|"assinatura válida"| run["Pod roda"]
    adm -->|"sem assinatura / assinante errado"| deny["Rejeitado"]
```

### O que tem dentro: o SBOM

Um **SBOM** (Software Bill of Materials) é a lista de ingredientes de um artefato: cada pacote, versão e licença, em um formato padrão — **CycloneDX** (OWASP) ou **SPDX** (Linux Foundation, ISO/IEC 5962)[^5]. Quando o próximo Log4Shell for anunciado, a pergunta "quais das nossas imagens contêm esta versão?" vira uma consulta, e não uma semana de pânico.

### Está vulnerável: varredura

Scanners (Trivy, Grype, Dependabot/Renovate para atualizações) cruzam o SBOM com bases de vulnerabilidades (identificadores CVE, advisories do GitHub). Bloqueie o pipeline com base em uma política — por exemplo, "nenhuma vulnerabilidade *crítica* com correção disponível" — e não em zero achados, o que nunca acontece.

### Veio de nós: assinatura e proveniência

O **cosign**, do Sigstore, assina imagens de container. No modo **keyless**, o job de CI prova a sua identidade com o seu token OIDC, um certificado de vida curta é emitido pela CA do Sigstore (Fulcio) e a assinatura é registrada em um log público de transparência (Rekor) — nenhuma chave de assinatura de vida longa para proteger[^6]. O **SLSA** (Supply-chain Levels for Software Artifacts) define níveis de integridade do build; a sua atestação de *proveniência* registra qual código, workflow e builder produziram o artefato[^7].

| Nível SLSA Build | Requisito | Protege contra |
|---|---|---|
| L1 | existe proveniência descrevendo como o artefato foi construído | "ninguém sabe como este binário foi produzido" |
| L2 | a proveniência é assinada por uma plataforma de build hospedada | adulteração depois do build |
| L3 | plataforma de build endurecida: execuções isoladas, chaves de assinatura inacessíveis aos passos do build | um passo de build comprometido forjando a proveniência |

O job de release do BoxOffice, reduzido aos passos de segurança (instalação das ferramentas omitida):

```yaml
permissions:
  contents: read
  packages: write
  id-token: write                      # keyless signing uses the job's OIDC identity
jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - id: build
        uses: docker/build-push-action@v6
        with:
          push: true
          tags: registry.example.com/boxoffice/order:${{ github.sha }}
      - name: SBOM
        run: syft registry.example.com/boxoffice/order@${{ steps.build.outputs.digest }} -o cyclonedx-json > sbom.cdx.json
      - name: Scan (fail on fixable critical CVEs)
        run: trivy image --severity CRITICAL --ignore-unfixed --exit-code 1 registry.example.com/boxoffice/order@${{ steps.build.outputs.digest }}
      - name: Sign and attest
        run: |
          IMAGE=registry.example.com/boxoffice/order@${{ steps.build.outputs.digest }}
          cosign sign --yes "$IMAGE"
          cosign attest --yes --type cyclonedx --predicate sbom.cdx.json "$IMAGE"
```

O último elo é a **verificação no momento do deploy**. Um admission controller (Kyverno, Sigstore policy-controller, OPA Gatekeeper) rejeita qualquer pod cuja imagem não tenha sido assinada pelo *nosso* workflow de release:

```yaml
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-boxoffice-images
spec:
  validationFailureAction: Enforce
  rules:
    - name: signed-by-release-workflow
      match:
        any:
          - resources:
              kinds: ["Pod"]
              namespaces: ["boxoffice"]
      verifyImages:
        - imageReferences: ["registry.example.com/boxoffice/*"]
          mutateDigest: true             # pin the tag to the verified digest
          attestors:
            - entries:
                - keyless:
                    issuer: "https://token.actions.githubusercontent.com"
                    subject: "https://github.com/repo-classes/pma271/.github/workflows/release.yaml@refs/heads/main"
```

Outros hábitos que fecham lacunas comuns: **fixar por digest** (`image@sha256:…`, actions pelo SHA do commit), usar imagens base mínimas ou distroless, rodar containers sem root e com sistema de arquivos somente leitura, usar um proxy de pacotes privado com nomes escopados para evitar dependency confusion, e seguir o Secure Software Development Framework (SSDF) do NIST como checklist do processo[^8].

**Experimente.** Abra o cenário `ai-assistant`. O assistente chama ferramentas (`catalog`, `order`) em nome do usuário: liste cada identidade no caminho (usuário, assistente, registro de ferramentas, serviços) e o que cada uma deveria poder fazer. Onde você colocaria o PEP de uma chamada de ferramenta? Quais segredos o LLM gateway guarda? (A aula de [Sistemas de IA](../../ai-systems/index.md) aprofunda o safety mesh.)

<div class="sdp" data-scenario="ai-assistant" data-mode="compact" data-height="520"></div>

---

## Uma checklist de defesa para o BoxOffice

| Área | Controle | Pronto quando… |
|---|---|---|
| Rede | sub-redes de dados isoladas, NAT por AZ, saída negada por padrão | `search` não consegue abrir uma conexão TCP com o banco nem com a Internet |
| Identidade de workload | mTLS STRICT no mesh + políticas de autorização | `curl payment/charges` a partir de `search` devolve 403 |
| Identidade de usuário | OIDC, PKCE, access tokens de 15 minutos, refresh tokens rotativos | nenhuma senha passa pelo app nem pelos nossos serviços |
| Autorização | verificações de posse; API de admin separada | o teste "usuário A lê o pedido do usuário B" falha |
| Segredos | gerenciador de segredos + ESO, IAM por serviço, rotação com duas chaves | `PSP_API_KEY` legível só por `payment`; runbook de rotação testado |
| Dados | criptografia em repouso com KMS, TLS em trânsito | backups e snapshots criptografados |
| Cadeia de suprimentos | SBOM, bloqueio por varredura, assinatura keyless, verificação na admissão | uma imagem não assinada não consegue subir em `boxoffice` |
| Detecção | logs de auditoria, alertas de requisições negadas | uma chamada negada vinda de `search` aciona alguém do plantão |

!!! tip "Na entrevista"
    "Zero Trust" é jargão, a menos que você o torne concreto. Diga três coisas: **toda chamada carrega uma identidade** (tokens para usuários, mTLS para serviços), **todo recurso verifica uma política** (menor privilégio, negação padrão, inclusive na saída) e **as credenciais são de vida curta** (identidade de workload, segredos dinâmicos, nenhuma chave estática no CI). Se o projeto tiver um provedor de pagamentos, acrescente: "a chave de API fica em um gerenciador de segredos, só o serviço de pagamento consegue lê-la, e rotacionamos com duas chaves ativas." Para a cadeia de suprimentos, uma linha basta: "o CI gera um SBOM, faz a varredura e assina as imagens; o cluster só roda imagens assinadas."

!!! warning "Armadilhas comuns"
    - **"É interno, então é seguro"** — a definição do modelo de perímetro.
    - **Uma credencial compartilhada por todos os serviços** — quando vaza, não dá para saber quem a usou, e a rotação quebra todo mundo ao mesmo tempo.
    - **Segredos no Git, em imagens, em ConfigMaps ou em logs de CI** — e "apagar o commit" em vez de rotacionar.
    - **Chaves estáticas da nuvem no CI** — use o token OIDC do CI e papéis de vida curta.
    - **Assinar sem verificar** — uma assinatura que ninguém confere no deploy não protege nada.
    - **Varredura sem política** — 400 achados e nenhum bloqueio significa que nada muda.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    PER["modelo de perímetro:<br/>dentro = confiável"] -->|"substituído por"| ZT["Zero Trust:<br/>nunca confie, sempre verifique"]
    ZT --> PEP["PEP: gateway para usuários,<br/>proxy do mesh para workloads"]
    PEP --> MESH["mTLS + política de autorização<br/>→ Service mesh"]
    ZT --> WI["identidade de workload:<br/>SPIFFE, papéis na nuvem, OIDC do CI"]
    WI --> SEC["gerenciador de segredos, segredos<br/>dinâmicos, rotação com duas chaves"]
    SEC --> KMS["envelope encryption<br/>com um KMS"]
    ZT --> SC["cadeia de suprimentos: SBOM,<br/>scan, cosign, SLSA"]
    SC --> ADM["política de admissão no deploy<br/>→ Cloud-native"]
    ZT --> DET["chamadas negadas registradas e alertadas<br/>→ Observabilidade"]
    DET --> IR["runbook de chave vazada<br/>→ resposta a incidentes"]
```

**Componentes da paleta:** [`apigw`](../../../reference/components/edge/index.md#apigw) e [`mesh`](../../../reference/components/network/index.md#mesh) (os pontos de aplicação) · [`payment`](../../../reference/components/external/index.md#payment) (a chave que só o `payment` pode ler) · [`logs`](../../../reference/components/observability/index.md#logs) · [`alerting`](../../../reference/components/observability/index.md#alerting) (auditoria e alertas de chamadas negadas) · [`llmgw`](../../../reference/components/ai/index.md#llmgw) · [`toolreg`](../../../reference/components/ai/index.md#toolreg) (identidades nas chamadas de ferramentas de um agente). **Cenários:** `ai-assistant`, `payment-system`. **Continua em:** [Service mesh](../service-mesh/index.md#mtls), [Identidade](../identity/index.md#delegation), [Cloud-native — entrega](../../cloud-native/delivery/index.md), [Observabilidade — resposta a incidentes](../../observability/incident-response/index.md), [Sistemas de IA — segurança e avaliações](../../ai-systems/safety-evals/index.md), [Hands-on 13 — segurança](../../../hands-on/13/security/index.md).

## Principais conclusões

- **Zero Trust**: não há rede confiável; toda requisição é autenticada, autorizada e criptografada em um **PEP**, usando a decisão de um **PDP**. Isso faz do pod comprometido um beco sem saída.
- **Identidade de workload** (SPIFFE/mTLS, papéis de nuvem para service accounts, OIDC no CI) substitui chaves estáticas por credenciais verificáveis de vida curta.
- **Segredos** pertencem a um gerenciador de segredos ou ao Vault, escopados por serviço, auditados, rotacionados (duas chaves) — de preferência **dinâmicos**; Secrets do Kubernetes são base64, não criptografia.
- **Envelope encryption** com um KMS protege dados em repouso; a varredura de segredos mantém chaves fora do Git.
- **Cadeia de suprimentos**: SBOM (o que tem dentro), varredura (está vulnerável), assinatura + proveniência + verificação na admissão (veio de nós, sem alterações).

---

[^1]: ROSE, S. et al. [NIST SP 800-207 — Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final){target="_blank"}. NIST, 2020.
[^2]: WARD, R.; BEYER, B. [BeyondCorp: A New Approach to Enterprise Security](https://research.google/pubs/beyondcorp-a-new-approach-to-enterprise-security/){target="_blank"}. *;login:*, v. 39, n. 6, 2014.
[^3]: GITHUB. [About security hardening with OpenID Connect](https://docs.github.com/en/actions/security-for-github-actions/security-hardening-your-deployments/about-security-hardening-with-openid-connect){target="_blank"}.
[^4]: KUBERNETES. [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/){target="_blank"} e [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/){target="_blank"}.
[^5]: OWASP. [CycloneDX](https://cyclonedx.org/){target="_blank"}; LINUX FOUNDATION. [SPDX](https://spdx.dev/){target="_blank"}.
[^6]: SIGSTORE. [Documentação do Sigstore — cosign, Fulcio, Rekor](https://docs.sigstore.dev/){target="_blank"}.
[^7]: OPENSSF. [SLSA — Supply-chain Levels for Software Artifacts, v1.0](https://slsa.dev/spec/v1.0/levels){target="_blank"}.
[^8]: SOUPPAYA, M.; SCARFONE, K.; DODSON, D. [NIST SP 800-218 — Secure Software Development Framework (SSDF)](https://csrc.nist.gov/pubs/sp/800/218/final){target="_blank"}. NIST, 2022.
