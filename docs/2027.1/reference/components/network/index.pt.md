# Rede { #network }

Os componentes de **rede** decidem *quem pode falar com quem*. Na nuvem você não liga cabos; você desenha uma rede privada (VPC), divide-a em sub-redes, decide quais sub-redes podem ser alcançadas a partir da internet, dá às máquinas privadas uma saída controlada (NAT gateway), conecta outras redes (VPN) e, dentro de um cluster, coloca uma camada programável entre os serviços (service mesh). Um bom design de rede é sobretudo **isolamento**: o banco de dados do BoxOffice deve ser inalcançável a partir da internet, qualquer que seja o bug da aplicação.

No playground, `vpc` e `subnet` são **molduras de grupo** (retângulos que você desenha em volta dos nós, com um rótulo de região ou zona de disponibilidade usado pelos eventos de queda), `nat` e `vpn` são nós no caminho das requisições, e `mesh` é um nó lateral ao qual os serviços se conectam.

| Componente | Em uma frase | Id no playground |
|---|---|---|
| [VPC](#vpc) | Sua rede privada e isolada numa região da nuvem | `vpc` |
| [Subnet](#subnet) | Uma fatia da VPC numa zona de disponibilidade, pública ou privada | `subnet` |
| [NAT Gateway](#nat) | Permite que máquinas privadas chamem a internet sem serem alcançáveis por ela | `nat` |
| [VPN](#vpn) | Um túnel criptografado entre redes (escritório, data center, outra nuvem) | `vpn` |
| [Service Mesh](#mesh) | Proxies ao lado de cada serviço: mTLS, retries, timeouts, divisão de tráfego, telemetria | `mesh` |

``` diagram
flowchart LR
    U[Usuários na internet] --> IGW[Internet gateway]
    subgraph VPC["VPC 10.0.0.0/16 (uma região)"]
      subgraph PUB["Sub-redes públicas (AZ a, AZ b)"]
        LB[Load Balancer]
        NAT[NAT Gateway]
      end
      subgraph PRIV["Sub-redes privadas (AZ a, AZ b)"]
        APP[Servidores de aplicação]
        DB[(Banco SQL)]
      end
    end
    IGW --> LB --> APP --> DB
    APP -->|só saída| NAT --> PSP[Provedor de pagamento]
    VPC <-->|túnel VPN| DC[Escritório / data center]
```

---

## VPC { #vpc }

**O que é.** Uma Virtual Private Cloud é uma rede logicamente isolada que pertence a você dentro de uma região da nuvem. Você escolhe a faixa de endereços privados (por exemplo `10.0.0.0/16`, 65.536 endereços), e nada entra nem sai a menos que você acrescente gateways e rotas. Todo o resto (sub-redes, tabelas de rotas, security groups, gateways) vive dentro de uma VPC. Pense nela como o prédio; as sub-redes são os andares e os security groups são as fechaduras de cada porta.

**Quando usar.**

- Sempre, para qualquer coisa que rode em máquinas virtuais, contêineres ou bancos gerenciados na nuvem: um sistema em produção vive em pelo menos uma VPC.
- **VPCs separadas** (ou contas/projetos) por ambiente (produção, homologação), para que um erro em homologação não alcance dados de produção.
- Uma VPC por região em designs multi-região, conectadas por peering ou transit gateway quando os serviços precisam conversar entre regiões.

**Quando não usar (ou cuidado).**

- Não crie muitas VPCs pequenas por serviço "para isolar" sem necessidade: conectá-las (peering, transit) traz custo e complexidade. Use security groups e sub-redes para isolar dentro de uma VPC.
- Planeje a faixa de endereços: faixas sobrepostas não podem ser conectadas por peering nem por VPN depois. Escolha blocos `/16` sem sobreposição por ambiente e região desde o primeiro dia.
- Designs totalmente serverless (funções e APIs gerenciadas) podem nem precisar de VPC, até o dia em que precisarem alcançar um banco privado.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Faixa de endereços | `/16` (65.536 IPs) é uma escolha comum | Faixas privadas da RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16` |
| Escopo | uma região, abrangendo todas as suas zonas de disponibilidade | As sub-redes são por zona |
| Ida e volta dentro de uma AZ | ≈ 0,1–0,5 ms | Ordem de grandeza de um mesmo datacenter |
| Ida e volta entre AZs de uma região | ≈ 1–2 ms | ≈ ilustrativo; confira no seu provedor |
| Custo da VPC em si | gratuita | Paga-se por gateways, tráfego entre AZs e saída de dados |

**Modos de falha.**

- **Blocos CIDR sobrepostos** — duas VPCs (ou a rede do escritório) com a mesma faixa não podem ser conectadas → um plano de endereçamento desde o início.
- **Tudo numa AZ** — a VPC abrange a região, mas se todas as sub-redes estão numa zona, a queda dessa AZ derruba o sistema → sub-redes em pelo menos duas AZs.
- **Exposição acidental** — uma rota para o internet gateway numa sub-rede de banco, ou um security group aberto para `0.0.0.0/0` → sub-redes privadas para dados, security groups de mínimo privilégio, verificação de políticas na infraestrutura como código.
- **Esgotamento de IPs** — uma faixa pequena se enche à medida que pods do Kubernetes recebem IPs → dimensione com folga ou use faixas secundárias.

**No playground.** `vpc` é uma **moldura de grupo**: desenhe-a em volta dos nós de uma região; ela tem um nome e um rótulo de região. Um evento de *queda de região* derruba todos os nós dentro da moldura marcada com aquela região, e é assim que o cenário `multi-region` mostra por que uma VPC só nunca é um plano de recuperação de desastres. A moldura em si não custa nada e não acrescenta latência. Cenários: [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Produtos reais.**

=== "AWS"

    - **Amazon VPC** — rede privada regional com sub-redes por AZ, tabelas de rotas, security groups e network ACLs.
    - **AWS Transit Gateway** — hub que conecta muitas VPCs e redes locais.

=== "GCP"

    - **VPC network** — VPC global cujas sub-redes são regionais; regras de firewall e rotas no nível da rede.
    - **Shared VPC** — a rede de um projeto host usada por vários projetos de serviço.

=== "Azure"

    - **Azure Virtual Network (VNet)** — rede privada regional com sub-redes e network security groups.
    - **Virtual network peering** — conecta VNets entre regiões.

=== "Código aberto"

    - Não há equivalente direto: a VPC é uma abstração da nuvem. Em hardware próprio, as mesmas ideias são VLANs e roteamento; no OpenStack, as redes do **Neutron**; localmente, as **redes do Docker** e as redes de cluster do **kind/minikube** fazem o papel de redes isoladas.

!!! tip "Na entrevista"
    "Tudo roda numa VPC com sub-redes em pelo menos duas zonas de disponibilidade: só o load balancer é público; serviços e bancos ficam em sub-redes privadas, e os security groups liberam apenas as chamadas de que o design precisa."

**Saiba mais:** [Rede e segurança › Rede na nuvem](../../../classes/network-security/cloud-network/index.md) · [Confiabilidade › Recuperação de desastres](../../../classes/reliability/disaster-recovery/index.md) · [Cloud-native › Kubernetes](../../../classes/cloud-native/kubernetes/index.md)

---

## Subnet { #subnet }

**O que é.** Uma sub-rede é uma faixa de endereços dentro da VPC que vive em **uma zona de disponibilidade**. O que torna uma sub-rede *pública* ou *privada* é a sua **tabela de rotas**: uma sub-rede pública tem rota para o internet gateway (então recursos com IP público são alcançáveis); uma privada não tem (seu tráfego de saída para a internet, se houver, passa por um NAT gateway). Security groups (com estado, por recurso) e network ACLs (sem estado, por sub-rede) acrescentam as regras de firewall.

**Quando usar.**

- O clássico layout de três camadas por AZ: sub-redes **públicas** para load balancers e NAT gateways, **privadas** para os servidores de aplicação, **isoladas/de dados** para bancos e caches, sem nenhuma rota para a internet.
- Duplique cada camada em pelo menos duas AZs, para que o load balancer e o banco possam fazer failover entre zonas.
- Sub-redes separadas quando as regras são diferentes (por exemplo, uma sub-rede para os nós do Kubernetes e outra para bancos gerenciados).

**Quando não usar (ou cuidado).**

- Não coloque servidores de aplicação em sub-redes públicas "para facilitar": todo servidor com IP público é superfície de ataque.
- Sub-redes não substituem security groups: dentro de uma VPC as sub-redes se roteiam entre si por padrão; é o security group que bloqueia `app → db` vindo do serviço errado.
- Tráfego entre AZs costuma ser cobrado por GB: serviços muito conversadores espalhados por zonas custam mais do que você imagina.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Tamanho típico | `/24` (256 endereços) a `/20` (4.096) | As nuvens reservam alguns endereços por sub-rede (a AWS reserva 5) |
| AZs por design | 2–3 | A maioria das regiões oferece 3 ou mais |
| Transferência entre AZs | ≈ USD 0,01 por GB em cada sentido | ≈ aproximado (2026), preços no estilo AWS |
| Avaliação de regras do security group | com estado: as respostas são liberadas automaticamente | NACLs são sem estado: os dois sentidos precisam de regras |

**Modos de falha.**

- **Queda de AZ** — todas as sub-redes daquela zona somem → sub-redes e réplicas redundantes em outra AZ, load balancer abrangendo as zonas.
- **Tabela de rotas errada** — uma sub-rede "privada" com rota para o internet gateway, ou uma privada sem rota de NAT que deixa de alcançar o provedor de pagamento → infraestrutura como código com revisão; teste as chamadas de saída depois de mudanças.
- **Esgotamento de IPs** — pods ou funções consomem todos os endereços e novas instâncias não sobem → faixas maiores, faixas separadas para pods.
- **NACL bloqueando respostas** — regras sem estado esquecem as portas efêmeras das respostas → prefira security groups para a maioria das regras.

**No playground.** `subnet` é uma **moldura de grupo** como `vpc`, desenhada dentro dela, com um rótulo de zona de disponibilidade (`a`, `b`, …). Um evento de *queda de AZ* derruba todos os nós dentro das molduras daquela zona. Coloque duas réplicas de `app` e uma réplica de banco em duas molduras de sub-rede diferentes e veja o load balancer continuar atendendo quando uma zona cai. Cenários: [`scale-out`](../../../../playground/scenarios/index.md#scale-out), [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`db-replicas`](../../../../playground/scenarios/index.md#db-replicas).

**Produtos reais.**

=== "AWS"

    - **VPC subnets** — sub-redes por AZ com tabelas de rotas, **security groups** e **network ACLs**.

=== "GCP"

    - **Subnets** — regionais (abrangem as zonas de uma região); **regras de firewall da VPC** e network tags controlam o acesso.

=== "Azure"

    - **Sub-redes de VNet** — com **network security groups (NSGs)** e tabelas de rotas; sub-redes delegadas para serviços gerenciados.

=== "Código aberto"

    - No Kubernetes, a **NetworkPolicy** (aplicada por CNIs como **Calico** ou **Cilium**) faz o papel dos security groups entre pods.
    - Em hosts Linux, **iptables / nftables** implementam as mesmas ideias de filtragem.

!!! tip "Na entrevista"
    "Três camadas por zona, duas zonas: as sub-redes públicas têm só o load balancer e o NAT gateway, as privadas têm os serviços e as de banco não têm rota nenhuma para a internet — assim um bug na aplicação não expõe o banco diretamente."

**Saiba mais:** [Rede e segurança › Rede na nuvem](../../../classes/network-security/cloud-network/index.md) · [Rede e segurança › Zero trust](../../../classes/network-security/zero-trust/index.md) · [Estimativas › Matemática da disponibilidade](../../../classes/estimation/availability-math/index.md)

---

## NAT Gateway { #nat }

**O que é.** A tradução de endereços de rede (NAT) permite que máquinas com endereços privados abram conexões **para** a internet sem serem alcançáveis **a partir** dela. O NAT gateway fica numa sub-rede pública; as sub-redes privadas mandam para ele o tráfego destinado à internet; ele reescreve o endereço de origem com o seu próprio IP público e acompanha cada conexão para que as respostas encontrem o caminho de volta. O serviço `payment` do BoxOffice, numa sub-rede privada, chama o provedor de pagamento pelo NAT gateway.

**Quando usar.**

- Serviços privados que precisam chamar APIs externas (provedores de pagamento, de e-mail, registros de pacotes, provedores de LLM) ou baixar imagens de contêiner e atualizações.
- Quando um parceiro externo precisa **liberar** o seu tráfego numa lista de permissões: todas as chamadas saem dos IPs públicos fixos do NAT gateway.

**Quando não usar (ou cuidado).**

- Tráfego para os próprios serviços do provedor de nuvem (object storage, filas) não deve passar pelo NAT: use **private endpoints / VPC endpoints**, mais baratos e que nunca saem da rede do provedor.
- NAT gateways são cobrados por hora **e por GB processado**: um serviço que baixa arquivos grandes pelo NAT pode custar mais que os servidores.
- Um NAT gateway por AZ: um único NAT numa zona é ponto único de falha e ainda gera cobrança entre AZs.
- Não serve para tráfego de entrada: o que precisa ser alcançável pela internet fica atrás de um load balancer.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Preço | ≈ USD 0,045 por hora + ≈ USD 0,045 por GB processado | ≈ preço de tabela aproximado da AWS (2026); as outras nuvens têm formato parecido |
| Banda | escala a dezenas de Gbps por gateway (a AWS documenta até 100 Gbps) | Confira os limites do provedor |
| Conexões simultâneas para um mesmo destino | dezenas de milhares por IP público (faixa de portas) | O esgotamento de portas é um limite real; acrescente IPs |
| Latência adicionada | ≈ menos de 1 ms | Desprezível perto da chamada externa |

**Modos de falha.**

- **Esgotamento de portas** — muitas conexões para o mesmo IP e porta de destino consomem as portas de origem → pool de conexões e keep-alive, mais IPs no NAT.
- **Falha zonal** — um NAT gateway único para todas as zonas falha ou sua zona cai → um NAT por AZ, e as sub-redes privadas de cada zona roteiam para o seu.
- **Susto no custo** — logs, imagens ou backups passando pelo NAT → VPC endpoints para os serviços do provedor, olhe a linha "por GB" da fatura.
- **Rota ausente** — depois de uma mudança na rede, os serviços privados perdem a saída em silêncio (timeouts para o provedor) → verificações sintéticas das dependências externas.

**No playground.** `nat` é um nó de **chamada** posicionado entre serviços privados e nós externos (`payment`, `email`, `thirdparty`). Ele tem uma capacidade (padrão 100.000 req/s) e um **custo por GB** (`payloadKB`, padrão 20 KB por requisição, a ≈ 0,045 USD/GB) que aparece no painel de custos; quando a capacidade é excedida, as chamadas para fora fazem fila e estouram o timeout. Cenários: [`payment-system`](../../../../playground/scenarios/index.md#payment-system), [`notification-system`](../../../../playground/scenarios/index.md#notification-system).

**Produtos reais.**

=== "AWS"

    - **NAT Gateway** — NAT gerenciado por AZ, com elastic IPs.
    - **VPC endpoints (Gateway / Interface, PrivateLink)** — acesso a S3, DynamoDB, SQS e outros sem NAT.

=== "GCP"

    - **Cloud NAT** — NAT gerenciado e definido por software para VMs e nós do GKE sem IP externo.
    - **Private Google Access / Private Service Connect** — acesso privado às APIs do Google.

=== "Azure"

    - **Azure NAT Gateway** — conectividade de saída gerenciada para sub-redes.
    - **Private Endpoint / Private Link** — acesso privado aos serviços do Azure.

=== "Código aberto"

    - **Masquerading com iptables / nftables** numa VM (uma "instância NAT") — barato, mas a disponibilidade é responsabilidade sua.
    - Egress gateways do Kubernetes (por exemplo o **Istio egress gateway**) centralizam e controlam o tráfego de saída.

!!! tip "Na entrevista"
    "Os serviços ficam em sub-redes privadas; as chamadas de saída para o provedor de pagamento passam por um NAT gateway por zona, com IPs fixos que o provedor pode liberar, e o tráfego para os serviços da própria nuvem usa private endpoints para não pagar a tarifa por GB do NAT."

**Saiba mais:** [Rede e segurança › Rede na nuvem](../../../classes/network-security/cloud-network/index.md) · [Computação › Integrações](../../../classes/compute/integrations/index.md) · [Cloud-native › FinOps](../../../classes/cloud-native/finops/index.md)

---

## VPN { #vpn }

**O que é.** Uma Virtual Private Network é um túnel criptografado que une duas redes pela internet como se fossem uma só. VPNs **site-to-site** (geralmente IPsec) conectam uma VPC a um escritório, a um data center ou a outra nuvem; VPNs **de cliente** permitem que o notebook de uma pessoa entre na rede privada. Para mais banda e latência mais estável, as empresas usam **interconexões dedicadas** (um link de fibra privado até a nuvem) em vez de VPNs, ou além delas.

**Quando usar.**

- Sistemas híbridos: o sistema legado de bilheteria num data center do estádio precisa alcançar o serviço `inventory` na nuvem de forma privada.
- Conectar duas nuvens, ou as redes de duas empresas, para uma integração específica.
- Acesso administrativo a recursos privados (embora a prática moderna prefira proxies cientes de identidade e acesso sem bastion; veja zero trust).

**Quando não usar (ou cuidado).**

- Não é um modelo de segurança por si só: "dentro da VPN = confiável" é exatamente o que o zero trust rejeita. Autentique e autorize cada chamada mesmo assim.
- A vazão de um único túnel IPsec é limitada (da ordem de 1 Gbps por túnel nas grandes nuvens); muita transferência de dados pede vários túneis ou uma interconexão dedicada.
- A latência é a do caminho pela internet mais a criptografia: evite um salto de VPN num caminho síncrono crítico em latência.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Vazão por túnel IPsec | ≈ até 1,25 Gbps (AWS Site-to-Site VPN) | ≈ aproximado; agregue vários túneis para mais |
| Latência adicionada | ≈ 5–20 ms sobre o caminho pela internet | Depende da distância; o playground usa mediana de 10 ms (≈ 5–20 ms) |
| Interconexão dedicada | portas de 1–100 Gbps | Privada, latência mais estável, custo fixo maior |
| Disponibilidade | dois túneis por conexão (endpoints redundantes) | Configure os dois; um entra em manutenção por vez |

**Modos de falha.**

- **Túnel fora do ar** — a renegociação de chaves falha ou o equipamento do lado do cliente reinicia → dois túneis (e de preferência dois equipamentos), roteamento dinâmico (BGP) para failover automático, alertas sobre o estado do túnel.
- **Saturação de banda** — um job de backup satura o túnel e o tráfego interativo sofre → qualidade de serviço, túneis separados ou uma interconexão.
- **Problemas de MTU** — o overhead da criptografia faz pacotes grandes se fragmentarem ou se perderem, causando travamentos misteriosos → MTU menor / MSS clamping.
- **Confiança excessiva** — um notebook comprometido na VPN alcança tudo → mínimo privilégio, segmentação, acesso zero trust.

**No playground.** `vpn` é um nó de **chamada** que acrescenta latência (mediana de 10 ms, lognormal: cerca de 5–20 ms) e pode falhar como unidade; use-o para ligar uma moldura que representa um sistema local aos serviços na nuvem e veja como uma chamada síncrona por VPN aparece no p99. Cenários: [`multi-region`](../../../../playground/scenarios/index.md#multi-region), [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure) (acrescente um salto de VPN ao caminho lento e compare).

**Produtos reais.**

=== "AWS"

    - **AWS Site-to-Site VPN** — túneis IPsec até um virtual private gateway ou transit gateway.
    - **AWS Client VPN** — acesso remoto gerenciado baseado em OpenVPN.
    - **AWS Direct Connect** — conexão privada dedicada.

=== "GCP"

    - **Cloud VPN (HA VPN)** — IPsec com SLA de 99,99% na configuração de alta disponibilidade.
    - **Cloud Interconnect** — interconexão dedicada ou via parceiro.

=== "Azure"

    - **Azure VPN Gateway** — VPN site-to-site e point-to-site.
    - **Azure ExpressRoute** — conectividade privada dedicada.

=== "Código aberto"

    - **WireGuard** — protocolo de VPN moderno, pequeno e rápido, embutido no Linux.
    - **OpenVPN** — VPN madura baseada em TLS.
    - **strongSwan** — implementação de IPsec para túneis site-to-site.

!!! tip "Na entrevista"
    "Para alcançar o sistema legado do estádio eu usaria uma VPN site-to-site redundante (ou uma interconexão, se o volume for alto), deixaria essa chamada fora do caminho síncrono da compra e continuaria autenticando cada requisição: estar na VPN não torna ninguém confiável."

**Saiba mais:** [Rede e segurança › Rede na nuvem](../../../classes/network-security/cloud-network/index.md) · [Rede e segurança › Zero trust](../../../classes/network-security/zero-trust/index.md)

---

## Service Mesh { #mesh }

**O que é.** Um service mesh coloca um proxy ao lado de cada serviço (um **sidecar** em cada pod, ou um proxy por nó no modo **ambient**) e faz todo o tráfego entre serviços passar por esses proxies. Um **plano de controle** os configura. Sem mudar o código da aplicação você ganha TLS mútuo (mTLS: os dois lados provam sua identidade e o tráfego é criptografado), retries, timeouts, circuit breaking, divisão de tráfego para canaries e métricas e traces uniformes para cada chamada.

**Quando usar.**

- Muitos serviços (dezenas ou mais), de times diferentes, em que implementar mTLS, retries e telemetria de forma consistente em cada código é inviável.
- Requisitos de zero trust dentro do cluster: toda chamada autenticada pela identidade da carga de trabalho, com políticas como "só `order` pode chamar `payment`".
- Entrega progressiva: mandar 5% do tráfego de `catalog` para a versão nova e aumentar aos poucos.

**Quando não usar (ou cuidado).**

- Poucos serviços: uma biblioteca (Resilience4j, um SDK do OpenTelemetry) e o mTLS da plataforma são mais simples. Um mesh é uma plataforma para operar, com suas próprias atualizações e modos de falha.
- Cada salto por um proxy acrescenta latência (sidecars acrescentam dois proxies por chamada) e memória por pod; com cadeias de chamadas profundas, isso soma.
- Retries no mesh **e** na aplicação se multiplicam (3 × 3 = 9 tentativas): decida onde os retries moram.

**Números-chave.**

| Métrica | Valor típico | Observação |
|---|---|---|
| Latência adicionada por salto | ≈ 1 ms ou menos no p50, mais na cauda | ≈ ilustrativo; depende do modo, dos recursos e da carga; o playground soma ~1 ms por salto |
| Memória do sidecar | dezenas de MB por pod | Os modos ambient / por nó reduzem isso |
| Validade do certificado mTLS | de horas a um dia, com rotação automática | Identidades de vida curta limitam o estrago de um vazamento |
| Granularidade da divisão de tráfego | passos de 1% (ou menores) | Usada em canaries |

**Modos de falha.**

- **Queda do plano de controle** — os proxies mantêm a última configuração, mas pods novos podem ficar sem certificados ou rotas → plano de controle em alta disponibilidade, monitoramento da expiração de certificados.
- **Amplificação de retries** — retries em várias camadas transformam um soluço numa tempestade → orçamento de retries, retries numa camada só.
- **Política mal configurada** — uma regra de negar por padrão bloqueia uma chamada legítima depois de um deploy → testes de políticas no CI, liberação gradual de políticas.
- **Proxy sem recursos** — sidecars sem CPU suficiente viram o gargalo → defina requests e limits para os proxies e acompanhe suas métricas.

**No playground.** `mesh` é um nó **lateral** (*side*), não uma caixa no caminho da requisição: os serviços conectados a ele pagam cerca de 1 ms de overhead do sidecar por salto de saída e recebem os padrões da malha em toda aresta que não define os seus — timeout `meshTimeoutMs` (1.000 ms), `meshRetries` (2) com backoff exponencial e jitter, e um circuit breaker. Uma malha conectada a `metrics` torna observado todo serviço conectado a ela. (O mTLS é presumido, não simulado.) Experimente o cenário `cascading-failure` com e sem mesh e compare com configurar `timeoutMs` e `circuitBreaker` à mão nas arestas. Cenários: [`cascading-failure`](../../../../playground/scenarios/index.md#cascading-failure), [`retry-storm`](../../../../playground/scenarios/index.md#retry-storm), [`observability-stack`](../../../../playground/scenarios/index.md#observability-stack).

**Produtos reais.**

=== "AWS"

    - **Amazon VPC Lattice** — rede gerenciada entre serviços, com políticas de autenticação entre VPCs e contas.
    - **Istio no Amazon EKS** — a escolha autogerenciada mais comum (o AWS App Mesh foi descontinuado).

=== "GCP"

    - **Cloud Service Mesh** — mesh gerenciado, baseado em Istio, para GKE e VMs.

=== "Azure"

    - **Complemento de service mesh baseado em Istio para o AKS** — Istio gerenciado no Azure Kubernetes Service.

=== "Código aberto"

    - **Istio** — o mesh mais usado; modos sidecar e ambient, construído sobre o Envoy.
    - **Linkerd** — mesh leve, com proxy próprio em Rust, focado em simplicidade.
    - **Cilium Service Mesh** — rede baseada em eBPF com recursos de mesh.
    - **Envoy** — o proxy por baixo de muitos meshes e gateways.

!!! tip "Na entrevista"
    "Com dezenas de serviços eu usaria um mesh para ter mTLS, timeouts, retries e telemetria em todas as chamadas sem mexer no código — mas ele custa latência por salto e uma plataforma para operar; com cinco serviços eu usaria bibliotecas, e manteria os retries numa camada só."

**Saiba mais:** [Rede e segurança › Service mesh](../../../classes/network-security/service-mesh/index.md) · [Rede e segurança › Zero trust](../../../classes/network-security/zero-trust/index.md) · [Confiabilidade › Padrões](../../../classes/reliability/patterns/index.md) · [Hands-on 9](../../../hands-on/9/index.md)
