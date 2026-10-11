
Imagine a loja rodando no Kubernetes. Uma biblioteca JSON vulnerável permite que um atacante execute código dentro de um pod do `product-service`. A partir dali, em uma configuração clássica, o atacante pode chamar o `account-service` diretamente com o header `id-account: <any id>` e ler todos os clientes, conectar-se ao Postgres com a senha encontrada nas variáveis de ambiente do pod e alcançar qualquer outro pod do cluster — porque "dentro do cluster" significa "confiável". Nada do que o gateway faz ajuda: o atacante já está atrás dele. Esta página trata de limitar o que um atacante consegue fazer **depois** que um componente é comprometido.

---

## Da segurança de perímetro ao Zero Trust

A **segurança de perímetro** tradicional (o modelo "castelo e fosso") confia em tudo o que está dentro da rede e bloqueia tudo o que está fora. O problema: uma vez que o atacante está dentro — por meio de uma credencial comprometida, de uma dependência vulnerável ou de alguém de dentro —, ele consegue se mover de máquina em máquina. Isso se chama **movimento lateral**.

O **Zero Trust** elimina a ideia de uma rede confiável. Seu princípio é **"nunca confie, sempre verifique"**: cada requisição é autenticada e autorizada por si só, independentemente de onde venha. O Google popularizou o modelo com o projeto BeyondCorp[^1], e o NIST o padronizou na SP 800-207[^2].

``` mermaid-sim
flowchart LR
    subgraph perimeter ["Modelo de perímetro"]
        fw["Firewall"] -->|"zona confiável"| int["Serviços internos<br>(confiam uns nos outros implicitamente)"]
    end
    subgraph zt ["Modelo Zero Trust"]
        any["Qualquer requisição<br>(interna ou externa)"] -->|"identidade + contexto"| pep["Ponto de aplicação<br>(gateway, sidecar)"]
        pep -->|"consulta"| pdp["Decisão de política"]
        pdp -->|"permite, privilégio mínimo"| res["Recurso"]
        pdp -->|"nega"| rej["Rejeitada"]
    end
```

O NIST nomeia as duas peças móveis: um **Policy Enforcement Point (PEP)** fica no caminho da requisição e a bloqueia ou encaminha, e um **Policy Decision Point (PDP)** decide, a partir da identidade e do contexto, se a requisição é permitida. Na loja, o **gateway** é o PEP para o tráfego externo; dentro do cluster, um **sidecar de service mesh** ao lado de cada serviço cumpre o mesmo papel para as chamadas internas.

### Princípios do Zero Trust

| Princípio | O que significa | Mecanismos |
|---|---|---|
| **Verificar a identidade explicitamente** | todo usuário *e todo workload* prova quem é a cada requisição | tokens OAuth 2.0 / OIDC, mTLS, SPIFFE |
| **Privilégio mínimo** | conceder apenas o acesso necessário, apenas pelo tempo necessário | escopos, RBAC/ABAC, tokens e credenciais de vida curta |
| **Presumir a violação** | projetar como se um atacante já estivesse dentro; limitar o raio de impacto | microssegmentação (NetworkPolicy), criptografia em trânsito e em repouso |
| **Validação contínua** | a confiança é reavaliada, não concedida uma única vez | TTLs curtos de tokens, nova autenticação para ações sensíveis, monitoramento |

### Exemplo: o pod comprometido, de novo

| Passo do atacante | Modelo de perímetro | Controle Zero Trust | Seção |
|---|---|---|---|
| Chamar o `account-service` com um header `id-account` forjado | aceito — quem chama está "dentro" | o `account-service` aceita chamadas apenas da identidade de workload do gateway (mTLS + política de autorização) | [mTLS](#service-to-service-identity-mtls) |
| Abrir uma conexão com qualquer pod | permitido | a NetworkPolicy permite apenas fluxos declarados; `product-service` → `account-service` não é um deles | [NetworkPolicy](#network-segmentation-with-networkpolicy) |
| Ler a senha do BD no ambiente e usá-la depois | funciona por meses | uma credencial de vida curta, por serviço, que expira em até uma hora | [Segredos](#secrets-management) |

---

## Identidade entre serviços: mTLS { #service-to-service-identity-mtls }

Como o `product-service` sabe que uma chamada vem mesmo do `order-service`? Um endereço IP não prova nada — pods são recriados com novos IPs, e um atacante pode enviar a partir de qualquer pod. A resposta é uma identidade criptográfica por workload.

- **TLS** (Transport Layer Security) — o protocolo por trás do HTTPS. O **servidor** apresenta um **certificado X.509** (sua chave pública mais o seu nome, assinados por uma **Autoridade Certificadora**, CA); o cliente o verifica. O canal é criptografado, mas o servidor não sabe quem é o cliente.
- **mTLS** (TLS mútuo) — o servidor *também* pede o certificado do cliente. **Os dois lados** apresentam certificados e verificam um ao outro: o canal é criptografado **e** as duas identidades são comprovadas.

``` mermaid-sim
sequenceDiagram
    autonumber
    participant Order as order-service
    participant CA as SPIRE (CA de workloads)
    participant Prod as product-service

    Order->>CA: atesta o workload, solicita SVID
    CA-->>Order: X.509 SVID: spiffe://cluster.local/ns/store/sa/order-service
    Prod->>CA: atesta o workload, solicita SVID
    CA-->>Prod: X.509 SVID
    Order->>Prod: ClientHello
    Prod-->>Order: ServerHello + certificado do product + CertificateRequest
    Order->>Order: verifica o certificado do product contra o trust bundle
    Order->>Prod: certificado do order + CertificateVerify (prova da chave privada)
    Prod->>Prod: verifica o certificado do order, lê o SPIFFE ID
    Note over Order,Prod: canal criptografado + identidade mútua
```

Emitir e rotacionar certificados à mão para dezenas de serviços não escala. O **SPIFFE**[^3] (Secure Production Identity Framework for Everyone) padroniza uma identidade de workload — uma URI como `spiffe://cluster.local/ns/store/sa/order-service` — e o **SVID** (SPIFFE Verifiable Identity Document), um certificado X.509 de vida curta que a carrega. O **SPIRE** é sua implementação de referência: ele verifica (*atesta*) qual workload está pedindo, tipicamente a partir da sua service account do Kubernetes, e emite certificados que, por padrão, duram cerca de uma hora e são rotacionados automaticamente.

**Service meshes** (Istio, Linkerd) injetam um proxy sidecar ao lado de cada pod que realiza o mTLS de forma transparente — sem mudanças no código da aplicação. O Istio deriva a identidade da service account do Kubernetes do pod, no mesmo formato SPIFFE.

### O mTLS autentica; uma política autoriza

O mTLS prova *quem* está chamando; ele não decide se quem chama *pode* chamar. Isso é uma **política de autorização**, avaliada pelo sidecar a cada requisição. Com o Istio[^4], permitir que apenas o `order-service` leia produtos fica assim:

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata:
  name: product-allow-order
  namespace: store
spec:
  selector:
    matchLabels:
      app: product-service
  action: ALLOW
  rules:
    - from:
        - source:
            principals: ["cluster.local/ns/store/sa/order-service"]
      to:
        - operation:
            methods: ["GET"]
            paths: ["/products/*"]
```

Assim que um workload tem pelo menos uma política `ALLOW`, as requisições que não casam com nenhuma de suas regras são negadas.

---

## Segmentação de rede com NetworkPolicy { #network-segmentation-with-networkpolicy }

Uma **NetworkPolicy**[^5] do Kubernetes é uma regra de firewall para pods: ela seleciona pods por label e lista quais outros pods (ou namespaces, ou faixas de IP) podem se conectar a eles, e em quais portas. Ela atua nas camadas 3/4 (IP e porta), então complementa o mTLS: mesmo que um atacante roube um certificado, a rede recusa conexões que nunca foram declaradas.

O padrão recomendado é **negar por padrão e depois permitir explicitamente**. Primeiro, negue todo o tráfego de entrada para todos os pods do namespace:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny-ingress
  namespace: store
spec:
  podSelector: {}        # all pods in the namespace
  policyTypes:
    - Ingress            # no ingress rules listed = nothing allowed
```

Depois, abra cada fluxo legítimo. Esta política permite que apenas os pods do `gateway-service` alcancem o `order-service` na porta 8080:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: order-service-ingress
  namespace: store
spec:
  podSelector:
    matchLabels:
      app: order-service
  policyTypes:
    - Ingress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              app: gateway-service
      ports:
        - port: 8080
```

As políticas são aditivas: um pod selecionado por qualquer política aceita apenas o tráfego que pelo menos uma política permite. Um `podSelector` dentro de `from` casa com pods **do mesmo namespace**; para permitir outro namespace, acrescente um `namespaceSelector`.

!!! warning "Uma NetworkPolicy só funciona se o plugin de rede a aplicar"
    A API do Kubernetes aceita objetos NetworkPolicy em qualquer cluster, mas quem os aplica é o plugin CNI (de rede). Calico e Cilium os aplicam; a rede padrão do minikube não, então a política é ignorada silenciosamente. Para testá-la no [Hands-on 5](../../../hands-on/5/index.md), inicie o cluster com `minikube start --cni=calico`.

---

## Gestão de segredos { #secrets-management }

Um **segredo** é qualquer valor que concede acesso: senhas de banco de dados, a `JWT_SECRET_KEY` do Hands-on 3, chaves de API, o token do Docker Hub do [Hands-on 4](../../../hands-on/4/index.md), chaves privadas. Segredos não devem ficar no código-fonte, em imagens de container ou em configuração em texto puro — em nada que seja copiado, versionado ou registrado em log.

!!! danger "Secrets do Kubernetes são base64, não criptografia"
    Um Secret do Kubernetes armazena os dados como strings codificadas em base64. Base64 é **codificação**, não criptografia — o secret do Postgres do [Hands-on 5](../../../hands-on/5/index.md) é decodificado com um único comando:

    ```bash
    echo c3RvcmU= | base64 -d        # prints: store
    kubectl get secret postgres-secrets -o jsonpath='{.data.POSTGRES_PASSWORD}' | base64 -d
    ```

    Qualquer um com permissão para ler Secrets no namespace — ou para criar ali um pod que os monte — consegue ler todos eles. Por padrão, eles também são armazenados sem criptografia no etcd, e um `secrets.yaml` commitado no Git fica público para todos que têm acesso ao repositório[^6].

Higiene mínima para Secrets nativos: habilite a **criptografia em repouso** do etcd[^7], restrinja `get`/`list` em Secrets com **RBAC** e mantenha os manifestos de segredos **fora do Git** (ou commite-os apenas criptografados, por exemplo com Sealed Secrets ou SOPS). Além disso, use um gerenciador de segredos externo:

| Abordagem | Prós | Contras |
|---|---|---|
| **Kubernetes Secrets** | simples, nativo | apenas base64; exige criptografia em repouso e disciplina com RBAC |
| **Gerenciadores de segredos em nuvem** (AWS Secrets Manager, GCP Secret Manager) | gerenciado, rotação automática, log de auditoria | preso a uma nuvem; latência extra |
| **HashiCorp Vault** | segredos dinâmicos, qualquer nuvem ou on-premises, auditoria detalhada | custo operacional |

Ferramentas como o External Secrets Operator sincronizam valores de um gerenciador em nuvem ou do Vault para Secrets nativos, de modo que as aplicações continuam a lê-los da forma usual.

O HashiCorp Vault introduz os **segredos dinâmicos**[^8]: em vez de guardar uma única senha de banco de vida longa compartilhada por todas as réplicas, o Vault cria um usuário de banco **único e de vida curta** para cada solicitante, com um *lease* (por exemplo, uma hora). Quando o lease expira, o Vault remove o usuário. Uma senha roubada de um pod comprometido deixa de funcionar sozinha, e o log de auditoria mostra exatamente qual pod usou qual credencial.

O padrão **Vault Agent Injector** acrescenta um sidecar que se autentica no Vault com a service account do pod e grava o segredo em um arquivo — aqui, `/vault/secrets/db` — que a aplicação lê; a credencial nunca aparece na especificação do pod, em um ConfigMap ou em uma variável de ambiente[^9]:

```yaml
annotations:
  vault.hashicorp.com/agent-inject: "true"
  vault.hashicorp.com/role: "order-service"
  vault.hashicorp.com/agent-inject-secret-db: "database/creds/order-service"
```

!!! warning "Erros comuns"
    - **Segredos no Git**, mesmo em um repositório privado ou "só para o ambiente de desenvolvimento" — o histórico os guarda para sempre; rotacione qualquer segredo que um dia tenha sido commitado.
    - **Uma única credencial compartilhada por todos os serviços** — quando ela vaza, não dá para saber quem a usou, e rotacioná-la quebra todo mundo de uma vez.
    - **Segredos em logs e mensagens de erro** — mascare-os, como o Jenkins faz com `withCredentials`.
    - **Tratar o mTLS como autorização** — um certificado válido prova identidade, não permissão; acrescente uma política de autorização.

---

## Pontos-chave

- O **Zero Trust** abandona a "rede interna confiável": toda requisição, interna ou externa, carrega uma identidade e é verificada contra uma política (PEP + PDP).
- Projete **presumindo a violação**: limite o que um pod comprometido consegue alcançar (NetworkPolicy), chamar (política de autorização) e ler (segredos de vida curta).
- O **mTLS** dá a cada workload uma identidade criptográfica; SPIFFE/SPIRE ou um service mesh emitem e rotacionam esses certificados automaticamente.
- A **NetworkPolicy** deve partir de **negar por padrão**, e só funciona com um CNI que a aplique.
- Um Secret do Kubernetes é **base64, não criptografia**; habilite a criptografia em repouso, restrinja o RBAC, mantenha segredos fora do Git e prefira um gerenciador de segredos com credenciais de vida curta.

[^1]: WARD, R.; BEYER, B. [BeyondCorp: A New Approach to Enterprise Security](https://research.google/pubs/beyondcorp-a-new-approach-to-enterprise-security/){target="_blank"}. *;login:*, v. 39, n. 6, 2014.
[^2]: ROSE, S. et al. [NIST SP 800-207 — Zero Trust Architecture](https://csrc.nist.gov/pubs/sp/800/207/final){target="_blank"}. NIST, 2020.
[^3]: SPIFFE. [SPIFFE Overview](https://spiffe.io/docs/latest/spiffe-about/overview/){target="_blank"}.
[^4]: ISTIO. [Authorization Policy](https://istio.io/latest/docs/reference/config/security/authorization-policy/){target="_blank"}.
[^5]: KUBERNETES. [Network Policies](https://kubernetes.io/docs/concepts/services-networking/network-policies/){target="_blank"}.
[^6]: KUBERNETES. [Good practices for Kubernetes Secrets](https://kubernetes.io/docs/concepts/security/secrets-good-practices/){target="_blank"}.
[^7]: KUBERNETES. [Encrypting Confidential Data at Rest](https://kubernetes.io/docs/tasks/administer-cluster/encrypt-data/){target="_blank"}.
[^8]: HASHICORP. [Vault — Database secrets engine](https://developer.hashicorp.com/vault/docs/secrets/databases){target="_blank"}.
[^9]: HASHICORP. [Vault Agent Injector](https://developer.hashicorp.com/vault/docs/platform/k8s/injector){target="_blank"}.
