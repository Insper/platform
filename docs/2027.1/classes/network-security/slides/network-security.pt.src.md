---
marp: true
lang: pt-BR
title: Redes e Segurança
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper</div>

# Redes e Segurança

**Fronteiras, identidades e menor privilégio — projetados, não remendados**

<!--
Roteiro: (1) segurança como projeto: STRIDE, defesa em profundidade, OWASP API Top 10; (2) redes em
nuvem: VPC, sub-redes, NAT, security groups; (3) service mesh: mTLS, políticas, tráfego; (4) identidade:
OAuth 2.1, OIDC, JWT; (5) Zero Trust, segredos, cadeia de suprimentos.
-->

---

## Quatro histórias do primeiro mês do BoxOffice

<div class="q">

Qual destes é um *bug em uma linha de código*?

</div>

- O laptop roubado de um prestador tem a **chave da API de pagamentos** em um `.env`.
- O time mobile quer **guardar a senha do usuário** no app.
- Às 10:00, **bots** pegam 30% das reservas e revendem os ingressos.
- Uma biblioteca vulnerável em `search` dá um shell ao atacante — e o **banco, `payment` e a Internet** estão a uma conexão.

* Nenhum. São problemas de **projeto**: fronteiras, identidades, privilégios, segredos.

---

## Modelagem de ameaças em quatro perguntas

1. **Em que estamos trabalhando?** Desenhe o diagrama de fluxo de dados (DFD).
2. **O que pode dar errado?** Marque as **fronteiras de confiança**; rode STRIDE por elemento.
3. **O que vamos fazer?** Mitigar, aceitar, transferir ou eliminar.
4. **Fizemos um bom trabalho?** Revise e repita quando o projeto mudar.

<div class="ok">

O checkout atravessa **cinco** fronteiras: Internet → borda → cluster → banco, cluster → provedor de pagamentos → webhook de volta.

</div>

<!--
As quatro perguntas de Adam Shostack. Desenhe o DFD do checkout na lousa, com subgrafos como fronteiras de confiança.
-->

---

<!-- _class: tight -->

## STRIDE no checkout

| Ameaça | Propriedade | Exemplo no BoxOffice | Controle |
|---|---|---|---|
| **S**poofing | autenticação | webhook "pagamento capturado" forjado | assinatura HMAC + nova consulta |
| **T**ampering | integridade | preço alterado no corpo da requisição | preço no servidor, imagens assinadas |
| **R**epudiation | não repúdio | "nunca comprei esses ingressos" | log de auditoria com usuário + trace id |
| **I**nfo disclosure | confidencialidade | `GET /orders/1043` mostra o pedido de outro fã | verificação de posse, gerenciador de segredos |
| **D**enial of service | disponibilidade | bots reservam 100 000 assentos | WAF, rate limits, sala de espera, TTL |
| **E**levation of privilege | autorização | pod `search` alcança o banco | NetworkPolicy, menor privilégio |

---

## Defesa em profundidade

- **Borda** — TLS, WAF, rate limiting, sala de espera.
- **Identidade** — OAuth 2.1 / OIDC, tokens de vida curta, MFA, passkeys.
- **AuthZ da requisição** — posse e papéis, em cada serviço.
- **Serviço a serviço** — mTLS + política de autorização do mesh.
- **Rede** — sub-redes privadas/isoladas, security groups, negação padrão.
- **Segredos e dados** — gerenciador de segredos, rotação, criptografia com KMS.
- **Cadeia de suprimentos** — SBOM, varredura, imagens assinadas.

<div class="ok">

As camadas são **independentes**: quando uma falha, a próxima ainda segura.

</div>

---

<!-- _class: tight -->

## OWASP API Security Top 10 (2023) — a checklist de projeto

| # | Risco | BoxOffice |
|---|---|---|
| API1 | Broken Object Level Authorization | `GET /orders/{id}` devolve qualquer pedido |
| API2 | Broken Authentication | tokens de 24 h; login sujeito a força bruta |
| API3 | Broken Object Property Level AuthZ | `PATCH {"status":"PAID"}` aceito |
| API4 | Unrestricted Resource Consumption | 5 000 reservas por conta |
| API5 | Broken Function Level AuthZ | fã chama `POST /admin/events` |
| API6 | Sensitive Business Flows | bots cambistas às 10:00 |
| API7 | SSRF | "pôster a partir de URL" → metadados da nuvem |
| API10 | Unsafe Consumption of APIs | confiar no corpo do webhook |

<div class="warn">

**BOLA** não se corrige no gateway: só `order` sabe quem é o dono do pedido 1043.

</div>

---

## Como um pacote atravessa a Internet

- Uma requisição é um **pacote IP**: roteadores leem só o **IP de destino**, nunca a URL.
- Dezenas de milhares de redes (**AS**) anunciam seus blocos com **BGP**.
- Cada roteador: **maior prefixo** → próximo salto; 10–20 saltos; o tempo é **distância**.
- O núcleo **não tem rota padrão**: um endereço que ninguém anuncia é descartado.

<div class="q">

Por que um fã não alcança o pod `payment` em `10.20.40.17`, mesmo com todos os firewalls abertos?

</div>

* `10.20.40.17` é **privado**: ninguém o anuncia, então o primeiro roteador do núcleo não tem rota e o descarta.

<!-- A página "Como a Internet funciona" tem o simulador do caminho do pacote: rode "Um fã tenta acessar um pod diretamente". -->

---

<!-- _class: tight -->

## Público, privado e a conta do CIDR

| Bloco | Tipo | Roteado na Internet? | Onde |
|---|---|---|---|
| `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` | privado (RFC 1918) | não | VPC `10.20.0.0/16`, Docker, Wi-Fi de casa |
| `100.64.0.0/10` | NAT da operadora (CGNAT) | não | o seu celular no 4G |
| `169.254.0.0/16` | link-local | não | serviço de metadados: credenciais! |
| todo o resto | **público** | **sim** | o load balancer e o NAT gateway |

- `/n` fixa os primeiros *n* bits: o bloco tem **2³²⁻ⁿ** endereços; cada bit a mais o **divide ao meio**.
- `10.20.32.0/19` = 8 192 endereços: `10.20.32.0` – `10.20.63.255`.

<div class="warn">

Privado é sobre **alcance**, não confiança: qualquer coisa dentro da rede ainda o alcança.

</div>

---

## NAT: muitos hosts privados, um endereço público

- O NAT de origem reescreve `10.20.40.17:51000` → `203.0.113.20:62001` e anota numa **tabela**.
- Respostas casam com a tabela; uma **conexão nova de fora** não casa com nada → descartada.
- O servidor vê o **IP do NAT**: milhares de fãs atrás de um IP de operadora.
- Um NAT dá um **IP de saída fixo** → a lista de permissões do provedor de pagamento.
- O NAT de destino publica um serviço privado: load balancer, IGW da nuvem, `ports:` do Docker.

<div class="ok">

Limite a taxa **por chave de API ou usuário**, não por IP: atrás do CGNAT um IP é um bairro inteiro.

</div>

---

## A VPC: a sua rede na nuvem

- **Região** → várias **AZs** (data centers independentes).
- **VPC** = faixa privada (RFC 1918), ex.: `10.20.0.0/16` = 65 536 endereços.
- **Sub-rede** = fatia da VPC em **uma** AZ; a AWS reserva **5** IPs por sub-rede.
- A **tabela de rotas** decide para onde vão os pacotes; toda tabela tem a rota `local`.

<div class="q">

Pods recebem IPs da VPC. Quantos cabem em uma sub-rede de aplicação `/24`? E em uma `/19`?

</div>

* `/24`: 256 − 5 = **251** — acabam no primeiro autoscale. `/19`: 8 192 − 5 = **8 187**.

---

<!-- _class: tight -->

## Pública, privada, isolada

| Sub-rede | `0.0.0.0/0` → | Alcançável da Internet | Alcança a Internet | BoxOffice |
|---|---|---|---|---|
| **Pública** | Internet Gateway | sim (IP público + SG) | sim | load balancer, NAT gateways |
| **Privada** | NAT gateway | não | só saída | nós EKS: gateway, order, payment… |
| **Isolada** | — | não | não | PostgreSQL, Redis, Kafka |

- Uma sub-rede é pública **por causa da tabela de rotas**, não de uma caixinha.
- **NAT gateway**: conexões só começam de dentro; dá um **IP de saída fixo** para a allow-list do provedor de pagamentos.

<div class="warn">

Um NAT vive em **uma AZ**. Um NAT para todas as AZs → a queda de uma AZ vira a queda do checkout. Use um por AZ.

</div>

---

## Security groups vs NACLs

<div class="cols">
<div>

**Security group**
- em uma interface de rede
- **stateful** (respostas permitidas)
- só regras de permissão
- a origem pode ser **outro SG**: `5432 a partir de sg-app`

</div>
<div>

**Network ACL**
- em uma sub-rede
- **stateless** (abrir portas efêmeras)
- permitir **e negar**, em ordem
- só origens CIDR — proteção grossa

</div>
</div>

<div class="warn">

Um SG não é identidade: *todo* pod nos nós de aplicação — inclusive o `search` comprometido — casa com `sg-app`.

</div>

---

## Entrando e saindo de forma privada

- **VPC endpoints** — S3 (gateway, gratuito) e ECR / Secrets Manager (interface) **fora da conta do NAT**.
- **Peering** (1:1, não transitivo) vs **transit gateway** (hub) vs **PrivateLink** (um serviço).
- **VPN site-to-site** (IPsec pela Internet) vs **link dedicado** (Direct Connect, Interconnect).
- **Session manager / IAP** em vez de um bastion com a porta 22 aberta.

<p class="small">Ilustrativo: 30 nós × 2 GB/dia de imagens + 50 GB/dia de logs ≈ 3,3 TB/mês pelo NAT, que nunca precisaram da Internet.</p>

<!--
Mencione a diferença do GCP: a VPC é global, o Cloud NAT é um serviço gerenciado. Azure: VNet, NSG.
-->

---

## Service mesh: plano de dados + plano de controle

- **Plano de dados** — um proxy em toda chamada: mTLS, política, retries, timeouts, telemetria.
- **Plano de controle** — configura os proxies e é a **autoridade certificadora**.
- A aplicação continua chamando `http://payment:8080`; os proxies promovem para **mTLS**.

| Sem mesh | Com mesh |
|---|---|
| cada time faz TLS, retries, métricas do seu jeito | uniforme, declarativo, por rota |
| "qualquer pod que saiba a URL chama `payment`" | só `sa/order` pode `POST /charges` |

---

<!-- _class: tight -->

## Sidecar vs ambient vs eBPF

| | Sidecar | Ambient (Istio) | eBPF (Cilium) |
|---|---|---|---|
| Proxy | um por pod | ztunnel por nó + waypoint opcional | kernel + Envoy compartilhado por nó |
| L7 em todo lugar? | sim | só com waypoint | só onde configurado |
| Sobrecarga | cresce com o nº de pods | baixa para L4 | a menor para L3/L4 |
| Atualização | reiniciar todos os pods | agentes dos nós + waypoints | agente do nó |

<div class="q">

9 serviços × 6 réplicas × 50 MB por sidecar (ilustrativo)?

</div>

* ≈ **2,7 GB** de memória só para proxies — e escala junto com o autoscaling da venda relâmpago.

---

## mTLS autentica, uma política autoriza

```yaml
apiVersion: security.istio.io/v1
kind: AuthorizationPolicy
metadata: { name: payment-allow-order, namespace: boxoffice }
spec:
  selector: { matchLabels: { app: payment } }
  action: ALLOW
  rules:
    - from: [{ source: { principals: ["cluster.local/ns/boxoffice/sa/order"] } }]
      to:   [{ operation: { methods: ["POST"], paths: ["/charges"] } }]
```

- Identidade = **SPIFFE ID** da service account, em um certificado de vida curta.
- `PeerAuthentication` **STRICT** rejeita texto puro; NetworkPolicy acrescenta negação padrão em L3/L4.

---

## Políticas de tráfego no mesh

- **Canary**: pesos 90 / 10 no `VirtualService` entre `v1` e `v2`.
- **Orçamento de timeout** por rota (`3s`), **retries** só em falhas de conexão.
- **Detecção de outliers**: ejetar uma réplica depois de 5 respostas 5xx seguidas.
- Limites do **pool de conexões** = bulkhead.

<div class="warn">

Retries na biblioteca (3) × retries no mesh (3) = **9 chamadas** por clique em um `payment` que já sofre. Faça retry em **uma** camada, e só de chamadas idempotentes.

</div>

---

## Zero Trust: nunca confie na rede

- **Verificar explicitamente** — todo usuário *e workload*, toda requisição.
- **Menor privilégio** — escopos estreitos, um usuário de banco por serviço, allow-lists de saída.
- **Assumir a violação** — negação padrão, dados isolados, segredos por serviço.
- **Contínuo** — vidas curtas, reautenticação para ações sensíveis, alertas.

<div class="ok">

O pod `search` comprometido vira um **beco sem saída**: sem rota até o banco, 403 de `payment`, sem `PSP_API_KEY`, sem saída.

</div>

<!--
NIST SP 800-207: o PEP (gateway, proxy do mesh) pergunta ao PDP. BeyondCorp para pessoas.
-->

---

## Identidade de workload e segredos

- Pod → pod: **SPIFFE / mTLS**. Pod → nuvem: **service account → papel na nuvem**. CI → nuvem: **token OIDC**, sem chaves guardadas.
- Secrets do K8s são **base64, não criptografia** — criptografe o etcd, RBAC restrito, nunca no Git.
- Fonte da verdade: **gerenciador de segredos / Vault**, sincronizado pelo External Secrets.
- Chave de pagamento: **duas chaves ativas** → rollout da #2 → verificar → revogar a #1.
- **Segredos dinâmicos**: um usuário de banco por pod, lease de 1 h. Envelope encryption com **KMS** em repouso.

---

## Cadeia de suprimentos: o quê, vulnerável, nosso?

- **SBOM** (CycloneDX / SPDX via syft) — o que tem dentro.
- **Varredura** (Trivy / Grype) — bloquear CVEs críticas com correção.
- **Assinar** (cosign keyless, identidade OIDC do job de CI) + **proveniência SLSA**.
- **Verificar na admissão** (Kyverno): só rodam imagens assinadas pelo nosso workflow de release.
- Fixar por **digest**; distroless, sem root; proxy de pacotes privado contra dependency confusion.

<div class="warn">

Assinar sem verificar não protege **nada**.

</div>

---

## Na entrevista

- Desenhe uma caixa **VPC**: sub-redes públicas (LB, NAT) e privadas (serviços, dados) em **2+ AZs**.
- "Saída para o provedor de pagamentos via **NAT por AZ** com IPs na allow-list."
- "Mobile: **Auth Code + PKCE**; o gateway valida **JWTs curtos** com JWKS; os serviços verificam a **posse**."
- "Dentro: **mTLS do mesh + políticas de autorização**, negação padrão."
- "Chave de pagamento em um **gerenciador de segredos**, rotacionada; o CI **assina** as imagens, o cluster verifica."

<div class="ok">

Uma ou duas frases concretas na hora certa valem mais que uma palestra sobre segurança.

</div>

---

## O mapa de conceitos de rede e segurança

<!-- _class: tight -->

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `waf` | é ataque ou bot? | OWASP API4/API6, regras contra bots, rate limits |
| `auth` | *quem* é o usuário, qual cliente? | OAuth 2.1 + PKCE, OIDC, Token Exchange |
| `apigw` | o token é válido? | JWKS, `iss`/`aud`/`exp`, remover headers |
| `vpc` `subnet` `nat` `vpn` | *onde* vive, o que o alcança? | CIDR, pública/privada/isolada, SGs, IP de saída |
| `mesh` | *qual serviço* pode chamar qual? | mTLS, SPIFFE, política de authz, NetworkPolicy |
| `payment` | quem guarda a chave que movimenta dinheiro? | gerenciador de segredos, rotação com duas chaves |
| *(todos)* | podemos confiar no código que roda? | SBOM, scan, cosign, SLSA |

<p class="small">Cada linha é uma camada da <b>defesa em profundidade</b>; Zero Trust significa que nenhuma delas confia na rede.</p>

---

## Conclusões

1. Segurança é **projeto**: modele ameaças com **STRIDE** sobre o fluxo de dados; confira o **OWASP API Top 10**.
2. **Defesa em profundidade**: camadas independentes, da borda à cadeia de suprimentos.
3. **VPC**: pública só pela rota ao IGW; saída privada via **NAT por AZ**; SGs stateful, NACLs stateless.
4. **Mesh**: mTLS autentica, **políticas autorizam**; retry em uma só camada.
5. **OAuth 2.1 + OIDC**: PKCE em todo lugar, tokens curtos, validar `iss`/`aud`/`exp`; **BOLA** em cada serviço.
6. **Zero Trust**: identidade em toda chamada, menor privilégio, assumir a violação.
7. **Segredos** em um gerenciador, rotacionados ou dinâmicos; **assine e verifique** o que roda.
