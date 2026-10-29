
No laptop de um desenvolvedor, o BoxOffice vive em uma rede Docker: todo container alcança todos os outros, e só o Nginx publica uma porta. Na nuvem, a decisão equivalente é muito maior e muito mais difícil de mudar depois. Quais máquinas recebem um endereço público? O banco de dados consegue chegar à Internet — e a Internet consegue chegar ao banco? Como o serviço `payment` chama o provedor, que só aceita requisições de **endereços IP em uma lista de permissão** (*allow-list*)? Como um engenheiro depura um pod sem abrir SSH para o mundo? Esta página constrói a rede do BoxOffice em um provedor de nuvem, um componente de cada vez.

Os exemplos usam os nomes da AWS, os mais comuns em descrições de vagas; as abas no fim mapeiam esses nomes para Google Cloud e Azure. As ideias são as mesmas em todo lugar[^1]. Esta página supõe que você sabe o que são um endereço IP, um bloco CIDR, um endereço privado e o NAT — se não, leia antes [Como a Internet funciona](../internet/index.md): ela tem a mesma rede do BoxOffice como um caminho de pacote interativo.

---

## A VPC: a sua própria rede privada na nuvem { #the-vpc-your-own-private-network-in-the-cloud }

Uma **VPC** (Virtual Private Cloud) é uma rede logicamente isolada dentro de uma região da nuvem. Você escolhe a faixa de endereços, a divide em sub-redes e decide cada rota de entrada e de saída. Nada entra nem sai de uma VPC a menos que você adicione um componente e uma rota que permitam isso.

| Conceito | Definição em uma linha |
|---|---|
| **Região** | uma área geográfica com vários data centers (ex.: `sa-east-1`, São Paulo) |
| **Zona de disponibilidade (AZ)** | um ou mais data centers isolados dentro de uma região, com energia e rede independentes |
| **VPC** | a sua rede privada, que abrange todas as AZs de uma região |
| **Sub-rede** (*subnet*) | uma fatia da faixa de endereços da VPC que vive em **uma** AZ |
| **Tabela de rotas** | regras associadas às sub-redes: "tráfego para este destino vai para aquele alvo" |

### Planejamento de CIDR { #cidr-planning }

Endereços são escritos em notação **CIDR** (Classless Inter-Domain Routing): `10.20.0.0/16` significa "os primeiros 16 bits são fixos", sobrando 32 − 16 = 16 bits para hosts, ou seja, 2¹⁶ = 65 536 endereços. Cada bit a mais no prefixo divide o bloco pela metade.

A VPC deve usar uma **faixa privada** (RFC 1918: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)[^2]. Duas regras poupam muita dor depois:

1. **Não sobreponha** com outras redes a que você talvez se conecte um dia — o escritório, outra VPC, um parceiro. Duas redes com faixas sobrepostas não podem ser roteadas entre si (o peering é recusado).
2. **Deixe espaço**: a faixa de uma VPC é difícil de mudar. Planeje para mais AZs e mais camadas de sub-redes do que você precisa hoje.

A AWS reserva **5 endereços em toda sub-rede** (endereço de rede, roteador da VPC, DNS, um reservado para uso futuro, broadcast)[^1]. A tabela abaixo é calculada, não digitada:

```python exec="true"
rows = []
for prefix in (16, 19, 20, 22, 24, 26, 28):
    total = 2 ** (32 - prefix)
    rows.append(f"| /{prefix} | {total:,} | {total - 5:,} |".replace(",", " "))
print("| /p | 2³²⁻ᵖ | 2³²⁻ᵖ − 5 (AWS) |")
print("|---|---|---|")
print("\n".join(rows))
```

!!! example "BoxOffice — o plano de CIDR"

    VPC `10.20.0.0/16` em `sa-east-1`, três AZs, três camadas por AZ:

    | Camada | AZ a | AZ b | AZ c | Por que esse tamanho |
    |---|---|---|---|---|
    | Pública (load balancer, NAT) | `10.20.0.0/24` | `10.20.1.0/24` | `10.20.2.0/24` | poucos recursos vivem aqui |
    | Aplicação privada (nós e pods do Kubernetes) | `10.20.32.0/19` | `10.20.64.0/19` | `10.20.96.0/19` | no AWS VPC CNI cada pod ocupa um IP: 8 187 utilizáveis por AZ |
    | Dados isolados (PostgreSQL, Redis, Kafka) | `10.20.8.0/22` | `10.20.12.0/22` | `10.20.16.0/22` | bancos são poucos, mas precisam de espaço para réplicas e failover |

    Cerca de metade do `/16` continua livre para uma quarta AZ ou uma nova camada. Os pods do Kubernetes são o motivo de as sub-redes de aplicação serem grandes: com o AWS VPC CNI, cada pod recebe um endereço real da VPC.

Confira o plano no explorador de endereços: divida `10.20.0.0/16` em 8 sub-redes. As três sub-redes de aplicação são os blocos `/19` 2, 3 e 4; os `/24` públicos e os `/22` de dados cabem todos no primeiro `/19` (`10.20.0.0` a `10.20.31.255`); os blocos 5 a 8 — metade da VPC — estão livres. Teste `10.20.17.4`: qual camada seria a dona dele?

<div class="netsim" data-tool="cidr" data-cidr="10.20.0.0/16"></div>

??? question "Pense antes: quantos pods cabem em uma sub-rede privada de aplicação?"

    Um `/19` tem 2¹³ = 8 192 endereços, menos 5 reservados = **8 187**. Os nós também ocupam endereços, e o CNI mantém alguns IPs "aquecidos" por nó, então o número real de pods é menor — mas na casa dos milhares por AZ. Um `/24` (251 utilizáveis) teria se esgotado no primeiro evento de autoscaling de uma venda relâmpago.

---

## Sub-redes públicas, privadas e isoladas { #subnets }

Uma sub-rede não é "pública" por causa de uma caixinha marcada. Ela é pública **por causa da sua tabela de rotas**: tem uma rota `0.0.0.0/0 → Internet Gateway`. Todo o resto decorre das rotas.

| Tipo de sub-rede | Rota padrão (`0.0.0.0/0`) | Alcançável a partir da Internet? | Alcança a Internet? | O BoxOffice usa para |
|---|---|---|---|---|
| **Pública** | Internet Gateway | sim, se o recurso tiver IP público e o security group permitir | sim | Application Load Balancer, NAT gateways |
| **Privada** | NAT gateway | não | sim, só saída, via NAT | nós do Kubernetes: `gateway`, `order`, `payment`, … |
| **Isolada** | nenhuma | não | não | PostgreSQL, Redis, Kafka |

Toda tabela de rotas também tem uma **rota local** implícita (`10.20.0.0/16 → local`): todas as sub-redes da VPC se alcançam no nível de roteamento. **O isolamento entre camadas é, portanto, trabalho dos security groups e das NACLs**, não das rotas.

O simulador leva um pacote por essas três camadas. Ele começa com o `payment` chamando o provedor: siga a consulta à tabela de rotas (`0.0.0.0/0 → NAT`), as duas reescritas do endereço de origem e a resposta voltando pela tabela do NAT. Depois desmarque *rota 0.0.0.0/0 → NAT* — o erro de configuração por trás de muitos incidentes de "o provedor de pagamento caiu" — e rode de novo; e rode *O PostgreSQL tenta baixar uma atualização da Internet* para ver o que significa uma sub-rede isolada.

<div class="netsim" data-tool="packet" data-scenario="pay-psp"></div>

### Internet Gateway e NAT gateway { #internet-gateway-and-nat-gateway }

- **Internet Gateway (IGW)** — associado à VPC; permite que recursos *com IP público* enviem e recebam tráfego da Internet. É escalado horizontalmente e altamente disponível por construção.
- **NAT gateway** — vive em uma sub-rede pública, com um endereço público fixo (um *Elastic IP*). Recursos privados enviam o tráfego de saída para ele; ele reescreve o endereço de origem para o seu próprio e mantém uma tabela de tradução, para que as respostas encontrem o caminho de volta. **Conexões só podem ser iniciadas de dentro.**

``` diagram-sim
sequenceDiagram
    autonumber
    actor U as Fã (mobile)
    participant IGW as Internet Gateway
    participant ALB as Load balancer (sub-rede pública)
    participant PAY as pod payment 10.20.40.17 (sub-rede privada)
    participant NAT as NAT gateway 15.228.x.x (sub-rede pública)
    participant PSP as Provedor de pagamentos
    U->>IGW: HTTPS checkout.boxoffice.com
    IGW->>ALB: para o endereço público do ALB
    ALB->>PAY: 10.20.40.17:8080 (via gateway → order)
    PAY->>NAT: origem 10.20.40.17 → destino PSP:443 (rota 0.0.0.0/0 → NAT)
    NAT->>PSP: origem 15.228.x.x (Elastic IP, na allow-list)
    PSP-->>NAT: 200 cobrança autorizada
    NAT-->>PAY: traduzido de volta para 10.20.40.17
    PAY-->>U: pedido confirmado (pelo ALB)
```

O provedor enxerga **um endereço de origem estável** — o Elastic IP do NAT gateway —, que o BoxOffice cadastra na allow-list do provedor. Os pods podem ser reagendados em qualquer nó; o endereço de saída nunca muda.

!!! warning "NAT gateways são por AZ"
    Um NAT gateway vive em **uma** AZ. Se todas as sub-redes privadas roteiam pelo NAT da AZ a e a AZ a falha, os pods das AZs b e c perdem acesso à Internet — `payment` não alcança o provedor e o checkout para. O projeto resiliente é **um NAT gateway por AZ**, com cada sub-rede privada roteando para o NAT da sua própria AZ. Isso custa três vezes o preço por hora e exige cadastrar três Elastic IPs no provedor. É um trade-off clássico entre disponibilidade e custo.

### Custo: a linha-surpresa na fatura { #cost-the-surprise-line-on-the-bill }

NAT gateways cobram por hora **e por GB processado**. Tráfego que não precisa ir para a Internet — baixar imagens do registry, gravar no object storage, ler segredos — ainda passa pelo NAT se nada mais for configurado. A correção é um **VPC endpoint**:

- **Gateway endpoints** (S3, DynamoDB na AWS) — uma entrada na tabela de rotas; gratuitos.
- **Interface endpoints** (PrivateLink) — um IP privado dentro da sua sub-rede que alcança um serviço da nuvem (Secrets Manager, ECR, KMS…) ou o serviço de um parceiro sem atravessar a Internet; cobrados por hora e por GB, em geral mais baratos que o NAT para tráfego pesado.

!!! example "BoxOffice — estimando o tráfego pelo NAT (números ilustrativos)"

    Suponha que cada nó do Kubernetes baixe ~2 GB de imagens por dia durante deploys, 30 nós, mais 50 GB/dia de logs enviados ao object storage. São ~110 GB/dia ≈ 3,3 TB/mês pelo NAT, de um tráfego que nunca precisou da Internet. Um gateway endpoint para o S3 e um interface endpoint para o ECR o tiram do NAT. Confira sempre os preços atuais do seu provedor; o que importa no projeto é a *estrutura* (por hora + por GB).

---

## Security groups e NACLs { #security-groups }

Rotas decidem *para onde* os pacotes podem ir; firewalls decidem *se* eles são permitidos. A AWS tem dois, em níveis diferentes:

| | **Security group (SG)** | **Network ACL (NACL)** |
|---|---|---|
| Associado a | uma interface de rede (instância, pod, load balancer, banco) | uma sub-rede |
| Estado | **stateful** — a resposta a uma requisição permitida é permitida automaticamente | **stateless** — entrada e saída precisam ser permitidas, incluindo portas efêmeras |
| Regras | só de permissão | de permissão e de negação, avaliadas em ordem numérica |
| Origens | CIDR **ou outro security group** | só CIDR |
| Uso típico | o controle principal, de granularidade fina | proteções grossas: bloquear uma faixa, separar camadas |

Trate-os como camadas da mesma defesa em profundidade[^4]. O recurso mais útil são as **referências entre SGs**: "permitir a porta 5432 a partir *do security group dos nós de aplicação*" em vez de "a partir de `10.20.32.0/19`". A regra acompanha os workloads quando eles escalam, se movem ou trocam de IP.

``` diagram
flowchart LR
    subgraph sgalb ["sg-alb"]
        ALB["ALB :443"]
    end
    subgraph sgapp ["sg-app"]
        N["nós EKS :8080"]
    end
    subgraph sgdb ["sg-db"]
        DB[("RDS :5432")]
    end
    I(["Internet 0.0.0.0/0"]) -->|"443"| ALB
    ALB -->|"8080 a partir de sg-alb"| N
    N -->|"5432 a partir de sg-app"| DB
```

!!! warning "Security groups não são identidade"
    Uma regra de SG diz "qualquer coisa nos nós de aplicação pode alcançar o banco". Com Kubernetes, *todo* pod nesses nós — inclusive o pod `search` comprometido — se encaixa. Um controle mais fino exige security groups por pod, NetworkPolicy do Kubernetes ou uma política de autorização do [service mesh](../service-mesh/index.md), além de credenciais de banco por serviço ([Zero Trust](../zero-trust/index.md)).

---

## A VPC do BoxOffice { #the-boxoffice-vpc }

Juntando tudo (duas das três AZs desenhadas):

``` diagram
flowchart TB
    NET(["Internet"]) --- IGW["Internet Gateway"]
    subgraph vpc ["VPC 10.20.0.0/16 — sa-east-1"]
        IGW
        subgraph aza ["AZ a"]
            subgraph puba ["pública 10.20.0.0/24"]
                ALBa["nó do ALB"]
                NATa["NAT gw + EIP"]
            end
            subgraph appa ["aplicação privada 10.20.32.0/19"]
                Ka["nós EKS<br/>gateway · order · payment · …"]
            end
            subgraph dataa ["dados isolados 10.20.8.0/22"]
                RDSa[("PostgreSQL primário")]
                Ra[("Redis")]
            end
        end
        subgraph azb ["AZ b"]
            subgraph pubb ["pública 10.20.1.0/24"]
                ALBb["nó do ALB"]
                NATb["NAT gw + EIP"]
            end
            subgraph appb ["aplicação privada 10.20.64.0/19"]
                Kb["nós EKS"]
            end
            subgraph datab ["dados isolados 10.20.12.0/22"]
                RDSb[("PostgreSQL standby")]
                Rb[("Réplica Redis")]
            end
        end
        EP["VPC endpoints<br/>S3 · ECR · Secrets Manager"]
    end
    IGW --> ALBa & ALBb
    ALBa --> Ka
    ALBb --> Kb
    Ka --> RDSa & Ra
    Kb --> RDSa
    NATa <-.-|"saída 0.0.0.0/0 → IGW"| Ka
    NATb <-.-|"saída 0.0.0.0/0 → IGW"| Kb
    Ka & Kb -.-> EP
    RDSa -.->|"replicação síncrona"| RDSb
```

### Como código { #as-code }

Redes são declaradas com **infraestrutura como código** (IaC), para poderem ser revisadas, versionadas e recriadas. Um esboço resumido em Terraform/OpenTofu de uma AZ (o módulo real faz um laço sobre as AZs):

```hcl
resource "aws_vpc" "boxoffice" {
  cidr_block           = "10.20.0.0/16"
  enable_dns_hostnames = true
  tags = { Name = "boxoffice-prod" }
}

resource "aws_subnet" "public_a" {
  vpc_id            = aws_vpc.boxoffice.id
  cidr_block        = "10.20.0.0/24"
  availability_zone = "sa-east-1a"
}

resource "aws_subnet" "app_a" {
  vpc_id            = aws_vpc.boxoffice.id
  cidr_block        = "10.20.32.0/19"
  availability_zone = "sa-east-1a"
}

resource "aws_subnet" "data_a" {
  vpc_id            = aws_vpc.boxoffice.id
  cidr_block        = "10.20.8.0/22"
  availability_zone = "sa-east-1a"
}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.boxoffice.id
}

resource "aws_eip" "nat_a" {
  domain = "vpc"
}

resource "aws_nat_gateway" "a" {
  subnet_id     = aws_subnet.public_a.id # NAT lives in the PUBLIC subnet
  allocation_id = aws_eip.nat_a.id       # fixed egress IP for the PSP allow-list
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.boxoffice.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_route_table" "app_a" {
  vpc_id = aws_vpc.boxoffice.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.a.id # egress only, same AZ
  }
}

# data subnets get a route table with no 0.0.0.0/0 route at all

resource "aws_route_table_association" "public_a" {
  subnet_id      = aws_subnet.public_a.id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table_association" "app_a" {
  subnet_id      = aws_subnet.app_a.id
  route_table_id = aws_route_table.app_a.id
}

resource "aws_security_group" "app" {
  name   = "sg-app"
  vpc_id = aws_vpc.boxoffice.id
}

resource "aws_security_group" "db" {
  name   = "sg-db"
  vpc_id = aws_vpc.boxoffice.id

  ingress {
    description     = "PostgreSQL only from the app nodes"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.app.id] # reference, not a CIDR
  }
}
```

Leia como um diagrama: a única rota `0.0.0.0/0 → igw` está na tabela pública; a tabela de aplicação manda a Internet para o NAT; as sub-redes de dados não têm rota padrão; o banco aceita a porta 5432 só de membros do `sg-app`.

**Experimente.** Abra o cenário `payment-system`. O serviço `payment` chama um provedor externo. Aumente a carga e injete caos no provedor: repare que toda chamada atravessa a fronteira de rede (no deploy real, pelo NAT gateway). Pergunte-se quais falhas pertencem à rede (NAT em uma só AZ, IP de saída fora da allow-list) e quais ao provedor. Refaça o projeto no [playground completo](../../../../playground/index.md) com os componentes `vpc`, `subnet` e `nat` para deixar as fronteiras visíveis.

<div class="sdp" data-scenario="payment-system" data-mode="compact" data-height="520"></div>

---

## Conectividade privada: alcançando outras redes { #private-connectivity }

O BoxOffice logo precisa falar com redes que não são suas: o escritório, a VPC do time de dados, um parceiro, uma segunda região.

| Opção | O que conecta | O tráfego passa por | Pontos fortes | Limites |
|---|---|---|---|---|
| **VPC peering** | duas VPCs, um para um | o backbone do provedor | simples, sem gargalo de banda, barato | não transitivo; CIDRs não podem se sobrepor; vira uma malha de N² ligações |
| **Transit gateway** (hub) | muitas VPCs e VPNs, em estrela | o backbone do provedor | roteamento central, escala para centenas de VPCs | custo por anexo e por GB; um componente central para operar |
| **PrivateLink / interface endpoint** | um *serviço* exposto dentro das VPCs consumidoras | o backbone do provedor | o consumidor vê só um IP, sem roteamento entre redes, CIDRs sobrepostos OK | um serviço por vez, em uma direção |
| **VPN site-to-site** (IPsec) | uma rede on-premises ou outra nuvem | a Internet pública, criptografada | rápida de configurar, barata | banda limitada por túnel, latência/jitter da Internet |
| **VPN de cliente / WireGuard** | laptops individuais de engenheiros | a Internet, criptografada | acesso para pessoas | uma VPN coloca o laptop "dentro" — confiança de perímetro clássica |
| **Link dedicado** (Direct Connect / Interconnect / ExpressRoute) | um data center até a nuvem | um circuito físico privado | latência estável, banda alta | semanas para provisionar, caro; normalmente com uma VPN de reserva |

### Dando acesso aos engenheiros: bastion vs session manager { #getting-engineers-in-bastion-vs-session-manager }

A resposta antiga é um **bastion host**: uma VM pequena em uma sub-rede pública com SSH aberto, de onde os engenheiros saltam para a rede privada. Ele é superfície de ataque (porta 22 na Internet) e um problema de gestão de chaves. A resposta moderna é um **serviço de sessão baseado em agente** (AWS Systems Manager Session Manager, GCP IAP TCP forwarding, Azure Bastion): o engenheiro se autentica no provedor de identidade da empresa com MFA, a sessão é aberta por um agente de dentro, **nenhuma porta de entrada fica aberta** e todo comando é registrado. Para o Kubernetes, o `kubectl` pela API autenticada do cluster cumpre o mesmo papel. Isso é Zero Trust aplicado a pessoas ([Zero Trust](../zero-trust/index.md)).

### DNS dentro da VPC { #dns-inside-the-vpc }

Serviços se encontram por nome. A VPC fornece um resolvedor (na AWS, no endereço base da VPC + 2); **zonas hospedadas privadas** dão nomes internos como `db.boxoffice.internal`, que só resolvem dentro da VPC. Dentro do Kubernetes, o CoreDNS resolve `payment.boxoffice.svc.cluster.local`. Os interface endpoints dependem do DNS privado para que `secretsmanager.sa-east-1.amazonaws.com` resolva para o IP privado do endpoint em vez do público.

---

## As mesmas ideias em outras nuvens { #the-same-ideas-in-other-clouds }

O vocabulário muda entre provedores; os blocos de construção, não[^3]. A maior diferença real: uma VPC do Google Cloud é **global**, enquanto as redes da AWS e do Azure são regionais.

=== "AWS"

    VPC (regional) · Subnet (por AZ) · Route table · Internet Gateway · NAT Gateway · Security Group + Network ACL · Gateway/Interface Endpoint (PrivateLink) · VPC Peering · Transit Gateway · Site-to-Site VPN · Direct Connect · Systems Manager Session Manager.

=== "Google Cloud"

    VPC network (**global**; sub-redes são regionais, não por zona) · Routes · Cloud NAT (um serviço gerenciado, sem instância por zona para posicionar) · regras de firewall da VPC e políticas de firewall hierárquicas (stateful, podem mirar **service accounts** ou tags de rede) · Private Service Connect · VPC Network Peering · Network Connectivity Center · Cloud VPN · Cloud Interconnect · Identity-Aware Proxy (IAP).

=== "Azure"

    Virtual Network (VNet, regional) · Subnet · Route table (User-Defined Routes) · NAT Gateway · Network Security Group (NSG) + Application Security Groups · Private Endpoint / Private Link · VNet Peering · Virtual WAN / hub-spoke · VPN Gateway · ExpressRoute · Azure Bastion.

=== "Kubernetes / on-premises"

    Uma rede de cluster (CNI: Calico, Cilium) com CIDRs de pods e de services · NetworkPolicy como firewall · um egress gateway (Cilium, Istio) para um IP de origem estável · túneis WireGuard ou IPsec entre sites · MetalLB para IPs de load balancer em bare metal.

---

## Trade-offs em resumo { #trade-offs-at-a-glance }

| Decisão | Opção A | Opção B | Escolha B quando… |
|---|---|---|---|
| Topologia de NAT | um NAT para a VPC (barato) | um NAT por AZ (resiliente) | chamadas de saída estão no caminho crítico (pagamento!) |
| Saída para serviços da nuvem | pelo NAT | VPC endpoints | o tráfego é pesado ou não pode atravessar a Internet |
| Endereçamento de pods | rede overlay (poucos IPs da VPC) | IPs da VPC nativos nos pods | você precisa de SGs/flow logs por pod e tem espaço de endereços |
| Conectar VPCs | peering | transit gateway | mais que um punhado de VPCs, ou também VPNs |
| Acesso administrativo | bastion + SSH | session manager / IAP | quase sempre |
| Granularidade do firewall | SG por camada | SG por pod / NetworkPolicy / política do mesh | clusters multi-tenant, serviços sensíveis |

!!! tip "Na entrevista"
    Quando desenhar o projeto de alto nível, coloque **uma caixa em volta com o rótulo VPC** e divida-a em sub-redes **públicas** (load balancer, NAT) e **privadas** (serviços, dados) em **pelo menos duas AZs**. Diga uma frase sobre o tráfego de saída: "as chamadas para o provedor de pagamentos saem por um NAT gateway por AZ, com um IP fixo que o provedor coloca na allow-list." Se o entrevistador perguntar sobre custo, mencione **VPC endpoints** para tirar o tráfego de object storage e de registry do NAT. Isso basta para mostrar que você já operou sistemas reais.

!!! success "Boas práticas"

    - **Espalhe cada camada por pelo menos duas, de preferência três, zonas de disponibilidade, com uma sub-rede por camada por zona** — perder uma zona então remove um terço da capacidade, não o serviço.
    - **Alcance os serviços da nuvem por VPC endpoints** — gateway endpoints para object storage, interface endpoints para o registry, os logs e o gerenciador de segredos: o tráfego fica privado e escapa da tarifa de processamento do NAT.
    - **Escreva regras de security group que referenciem outros grupos, não CIDRs** — o `db-sg` permite 5432 só a partir do `app-sg`, então a regra acompanha as instâncias enquanto elas escalam.
    - **Não dê às sub-redes de dados nenhuma rota para a Internet** — nenhuma entrada `0.0.0.0/0` na tabela de rotas, para que um host de banco comprometido não consiga exfiltrar dados diretamente.
    - **Ligue os VPC flow logs (pelo menos o tráfego rejeitado) e guarde-os por cerca de 90 dias** — é o único jeito de responder "com quem este host falou?" depois de um incidente.
    - **Mude a rede só por revisão de código** — Terraform (ou similar) com o plano anexado ao pull request; nenhuma mudança pelo console em produção.

!!! warning "Armadilhas comuns"
    - **SSH ou RDP abertos para `0.0.0.0/0`** — varridos em minutos; use um session manager.
    - **Banco de dados em sub-rede pública** "só para conectar do meu laptop" — a uma senha fraca de um vazamento.
    - **Um único NAT gateway** para todas as AZs — a queda de uma AZ vira, silenciosamente, a queda do checkout.
    - **CIDRs sobrepostos** (`10.0.0.0/16` em todo lugar) — descobertos no dia em que você precisa fazer peering com o time de dados ou com um parceiro.
    - **Sub-redes pequenas demais** para IPs de pod nativos da VPC — o cluster para de agendar pods durante a venda relâmpago.
    - **Ignorar a cobrança de processamento de dados do NAT** — downloads do registry e envio de logs pelo NAT podem custar mais que os servidores.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    VPC["VPC + plano de CIDR"] --> SUB["sub-redes públicas / privadas /<br/>isoladas, uma por AZ"]
    SUB --> RT["tabelas de rotas:<br/>IGW, NAT ou nenhuma"]
    RT --> NAT["NAT gateway por AZ<br/>IP de saída estável"]
    NAT --> PSP["allow-list do provedor<br/>→ Compute: integrações"]
    SUB --> SG["security groups + NACLs"]
    SG --> NOID["não são identidade: NetworkPolicy,<br/>política do mesh → Service mesh"]
    SUB --> AZ["queda de AZ e de região<br/>→ Confiabilidade"]
    VPC --> CON["peering, transit, PrivateLink,<br/>VPN, session manager"]
    CON --> ZT["acesso de pessoas<br/>→ Zero Trust"]
    VPC --> IAC["Terraform / OpenTofu<br/>→ Cloud-native"]
```

**Componentes da paleta:** [`vpc`](../../../reference/components/network/index.md#vpc) · [`subnet`](../../../reference/components/network/index.md#subnet) · [`nat`](../../../reference/components/network/index.md#nat) · [`vpn`](../../../reference/components/network/index.md#vpn) · [`lb`](../../../reference/components/edge/index.md#lb) (o ALB nas sub-redes públicas) · [`payment`](../../../reference/components/external/index.md#payment) (alcançado pelo NAT). **Cenários:** `payment-system`, `multi-region`, `scale-out`. **Continua em:** [Service mesh](../service-mesh/index.md), [Zero Trust](../zero-trust/index.md), [Compute — integrações](../../compute/integrations/index.md), [Confiabilidade — recuperação de desastres](../../reliability/disaster-recovery/index.md#multi-region), [Cloud-native — entrega](../../cloud-native/delivery/index.md) (infraestrutura como código).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Uma **VPC** é a sua rede privada em uma região; **sub-redes** vivem em uma AZ; uma sub-rede é pública só porque a sua tabela de rotas aponta `0.0.0.0/0` para um **Internet Gateway**.
    - Sub-redes privadas alcançam a Internet **apenas na saída**, por um **NAT gateway**, que também dá um IP de saída estável para allow-lists; use um por AZ em caminhos críticos.
    - **Security groups** são stateful e podem referenciar uns aos outros; **NACLs** são proteções stateless no nível da sub-rede. Nenhum dos dois é identidade de workload.
    - Planeje **CIDRs** com folga e sem sobreposição; a AWS reserva 5 endereços por sub-rede; pods podem precisar de muitos IPs.
    - Use **VPC endpoints** para serviços da nuvem, **peering/transit/PrivateLink** entre redes, **VPN ou links dedicados** até o on-premises, e **session managers** em vez de bastions.

---

[^1]: AMAZON WEB SERVICES. [Amazon VPC User Guide](https://docs.aws.amazon.com/vpc/latest/userguide/what-is-amazon-vpc.html){target="_blank"} — sub-redes, tabelas de rotas, NAT gateways, security groups, network ACLs.
[^2]: REKHTER, Y. et al. [RFC 1918 — Address Allocation for Private Internets](https://datatracker.ietf.org/doc/html/rfc1918){target="_blank"}. IETF, 1996.
[^3]: GOOGLE CLOUD. [VPC network overview](https://cloud.google.com/vpc/docs/vpc){target="_blank"}; MICROSOFT. [Azure Virtual Network overview](https://learn.microsoft.com/en-us/azure/virtual-network/virtual-networks-overview){target="_blank"}.
[^4]: AMAZON WEB SERVICES. [AWS Well-Architected Framework — Security Pillar: Infrastructure protection](https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/infrastructure-protection.html){target="_blank"}.
