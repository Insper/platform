Uma réplica de `inventory` aguenta, digamos, 800 holds por segundo antes de a latência subir (um número ilustrativo — no [hands-on 2](../../../hands-on/2/index.md) você mede o número real para `catalog`). A venda do estádio precisa de 5.000. A resposta é óbvia — rodar sete ou oito réplicas —, mas ela levanta na hora as perguntas que esta página responde: **quem decide qual réplica recebe cada requisição? O que acontece quando uma réplica morre, fica lenta ou está sendo reimplantada? E se a requisição precisar cair numa réplica específica?**

Um **load balancer** (LB) é o componente que distribui o trabalho por um pool de servidores intercambiáveis — os **backends**, **targets** ou **upstreams** —, de modo que o pool se comporte como um único servidor, maior e mais confiável[^1]. Ele é o componente `lb` da paleta e, no Kubernetes, o componente `ingress` faz o mesmo papel para o tráfego HTTP que entra no cluster.

---

## Por que balancear carga? { #why }

Um load balancer dá três coisas de uma vez:

- **Escalabilidade**: adicionar réplicas para atender mais tráfego (*escala horizontal*, ou *scale-out*), em vez de comprar uma máquina maior (*escala vertical*, ou *scale-up*).
- **Disponibilidade**: quando uma réplica falha nos health checks, o LB para de mandar tráfego para ela; os usuários não percebem.
- **Operabilidade**: dá para drenar, substituir e atualizar réplicas uma de cada vez (rolling deploys), sem downtime.

Isso só funciona se as réplicas forem **intercambiáveis** — qualquer uma delas atende qualquer requisição. É por isso que os servidores de aplicação devem ser **stateless**: dados de sessão, carrinhos e holds de assentos ficam num store compartilhado (Redis, PostgreSQL), não na memória de uma réplica. Não ter estado é a pré-condição de tudo nesta página.

``` diagram-sim
flowchart LR
    f([Fãs]) --> lb{{Load balancer}}
    lb --> a1[inventory-1]
    lb --> a2[inventory-2]
    lb --> a3[inventory-3]
    lb -.->|"health check falha: ignorada"| a4["inventory-4 ✗"]
    a1 --> db[(PostgreSQL)]
    a2 --> db
    a3 --> db
```

---

## L4 versus L7 { #l4-l7 }

Load balancers diferem em **quanto do tráfego eles entendem**.

Um load balancer de **camada 4 (L4)** trabalha com conexões TCP ou datagramas UDP. Ele vê endereços IP e portas, escolhe um backend quando uma conexão abre e encaminha os bytes daquela conexão para ele. Ele não lê HTTP: não consegue rotear por path, não percebe que uma conexão carrega 1.000 requisições e não precisa decifrar TLS.

Um load balancer de **camada 7 (L7)** fala HTTP. Ele termina a conexão do cliente, lê cada **requisição** (método, path, headers, cookies), escolhe um backend por requisição e abre (ou reaproveita) a sua própria conexão com ele. É um reverse proxy completo.

| | L4 (transporte) | L7 (aplicação) |
|---|---|---|
| Unidade de balanceamento | conexão (ou fluxo de pacotes) | requisição |
| Enxerga | IPs, portas, TCP/UDP | método, path, host, headers, cookies, corpo |
| TLS | normalmente passa cifrado | normalmente termina (decifra) |
| Roteamento por path ou host | não | sim: `/api/holds → inventory`, `/api/orders → order` |
| Retries, reescrita de headers, cache, compressão | não | sim |
| Desempenho | altíssimo (milhões de conexões, microssegundos) | alto, mas com mais CPU por requisição |
| Conexões de longa duração (gRPC, HTTP/2, WebSockets) | balanceadas uma vez, na conexão | pode balancear cada requisição/stream |
| Exemplos | AWS NLB, GCP passthrough Network LB, Azure Load Balancer, Linux IPVS, HAProxy em modo TCP | AWS ALB, GCP Application LB, Azure Application Gateway, Nginx, HAProxy, Envoy, Traefik |

Um layout comum em produção usa **os dois**: um load balancer L4 (ou anycast) na frente, pela capacidade bruta e pela resiliência a DDoS, distribuindo conexões por uma frota de proxies L7 (Envoy, Nginx) que fazem TLS, roteamento e balanceamento por requisição. É assim que os front ends do Google e da Cloudflare são construídos.

??? question "Pense antes: o serviço `order` chama `inventory` via gRPC através de um load balancer L4. Há 4 réplicas de `inventory`, mas uma delas recebe quase todo o tráfego. Por quê?"
    O gRPC roda sobre HTTP/2, que multiplexa muitas requisições sobre **uma única conexão TCP de longa duração**. Um load balancer L4 escolhe o backend uma vez por conexão; então, se `order` abriu uma conexão (ou poucas) e a mantém por horas, todas as suas requisições vão para a mesma réplica. Soluções: um load balancer L7 que balanceie por requisição (Envoy, um service mesh), balanceamento no cliente pela biblioteca gRPC, ou limitar a idade das conexões (`max_connection_age`) para que os clientes reconectem periodicamente. Mais em [Protocolos](../protocols/index.md).

---

## Algoritmos de balanceamento { #algorithms }

Depois que o LB tem a lista de backends saudáveis, ele precisa de uma regra para escolher um. A regra importa mais quando as requisições têm **custos diferentes** ou os backends têm **velocidades diferentes**.

| Algoritmo | Como escolhe | Ponto forte | Ponto fraco |
|---|---|---|---|
| **Round robin** | o próximo backend de um ciclo fixo | simples, justo quando requisições e servidores são uniformes | ignora a carga: um servidor lento recebe tantas requisições quanto um rápido |
| **Weighted round robin** | ciclo proporcional a pesos (p. ex. 2:1) | mistura tamanhos de máquina; canaries (peso de 5%) | os pesos são estáticos |
| **Random** | escolha aleatória uniforme | sem estado, funciona com muitas instâncias de LB | desequilíbrio de curto prazo |
| **Least connections** | o backend com menos conexões/requisições ativas | se adapta a requisições lentas e servidores lentos | precisa de estado compartilhado; engana com conexões longas ociosas |
| **Least response time / EWMA** | menor latência recente (média móvel exponencialmente ponderada) × carga | desvia de servidores degradados | pode criar um rebanho sobre um servidor que acabou de ficar rápido |
| **Power of two choices (P2C)** | sorteia **dois** backends e envia ao menos carregado | equilíbrio quase ótimo, quase sem coordenação | precisa de um sinal de carga (requisições em andamento) |
| **IP hash / source hash** | `hash(client IP) mod N` | mesmo cliente → mesmo backend, sem cookie | desigual com NATs e proxies; embaralha tudo quando N muda |
| **Hashing consistente** | `hash(key)` posicionado num anel de backends | mesma chave → mesmo backend; adicionar um nó move só ~1/N das chaves | precisa de nós virtuais para equilibrar; hot keys continuam quentes |

Dois deles merecem mais atenção.

### Power of two choices { #p2c }

Escolher o backend menos carregado entre *todos* parece ideal, mas, com muitas instâncias de load balancer (cada uma com uma visão um pouco desatualizada), todas escolhem o mesmo servidor "menos carregado" ao mesmo tempo e o sobrecarregam — um **rebanho** (*herd*). Escolher um backend ao acaso evita o rebanho, mas deixa, por azar, alguns servidores bem mais ocupados que outros. Mitzenmacher mostrou que um pequeno meio-termo pega quase o melhor dos dois: **sortear dois backends e escolher o menos carregado**[^2]. A carga máxima cai exponencialmente em comparação com a escolha puramente aleatória, e não há rebanho, porque instâncias diferentes do LB sorteiam pares diferentes. Envoy, Nginx (`random two least_conn`), HAProxy e as bibliotecas gRPC implementam esse algoritmo; ele é a escolha padrão de muitos proxies modernos.

<div class="csim" data-sim="lb" data-algo="rr" data-rate="100" data-factor="5"></div>

!!! tip "Experimente"
    Os quatro algoritmos roteiam as **mesmas** 100 requisições/s para quatro réplicas de `catalog` de cerca de 40 requisições/s cada; o gráfico desenha o p99 de cada um.

    1. Rode por 10 s com réplicas saudáveis: todos os p99 ficam baixos (cerca de 100 ms; o aleatório, cerca de 200 ms, pelo seu desequilíbrio de curto prazo).
    2. Ligue **catalog-3 fica lento**. O round robin continua mandando para ele **25%** das requisições, mais do que as suas 8/s: depois de 10 s a fila dele tem cerca de 180 requisições e o p99 chega a cerca de **23 s** — enquanto o p50 fica perto de 30 ms, porque só uma requisição em cada quatro espera.
    3. Escolha **menos conexões** (least connections) e depois **duas escolhas (P2C)**: as requisições abertas de catalog-3 se acumulam, então ele recebe só cerca de 7% e 10% do tráfego e o p99 fica em torno de 0,5 s e 0,6 s. É a coluna "se adapta a servidores lentos" da tabela.
    4. O padrão do Nginx no [lab 3](../../../hands-on/3/index.md) é round robin; `least_conn` é a linha comentada em `nginx.conf`.


### Hashing consistente { #consistent-hashing }

Às vezes você *quer* que a mesma chave vá para o mesmo backend: um servidor de cache que guarda os dados de um usuário, um servidor WebSocket que mantém uma sala de chat, um shard de um key-value store. O jeito ingênuo é `server = hash(key) mod N`. Funciona até N mudar: passar de 5 para 6 servidores muda o resultado do `mod` para a **maioria** das chaves, então quase toda chave se move — todo cache erra ao mesmo tempo.

O **hashing consistente** (Karger et al., 1997)[^3] coloca servidores e chaves num círculo de valores de hash (o **anel**). Uma chave pertence ao primeiro servidor encontrado andando no sentido horário a partir da sua posição.

``` diagram-sim
flowchart LR
    A["nó A<br/>posição 10"] -->|horário| B["nó B<br/>posição 40"]
    B -->|horário| D["novo nó D<br/>posição 55"]
    D -->|horário| C["nó C<br/>posição 75"]
    C -->|"horário (volta ao 0)"| A
    k1(["hold:42 → 30"]) -.->|dono| B
    k2(["hold:77 → 50"]) -.->|"dono: era C, agora D"| D
    k3(["hold:91 → 90"]) -.->|"dono (dá a volta)"| A
```

No diagrama, as posições vão de 0 a 99: `hold:42` tem hash 30 e pertence a B (o primeiro nó na posição 30 ou depois); `hold:91` tem hash 90 e dá a volta até A. Quando o nó D entra na posição 55, só as chaves entre 40 e 55 — como `hold:77` — passam de C para D; nada mais muda. Em geral, quando um servidor é adicionado, ele assume apenas as chaves entre ele e o seu antecessor — cerca de **1/(N+1)** delas; quando um é removido, só as chaves dele se movem, para o sucessor.

Com um ponto por servidor, os arcos do anel têm comprimentos muito diferentes, e alguns servidores ficam com bem mais do que a sua parte. A solução são os **nós virtuais**[^5]: cada servidor físico é colocado no anel muitas vezes (100–200 pontos, por exemplo), e os arcos se equilibram na média. Os nós virtuais também facilitam dar mais pontos a uma máquina maior (pesos) e, quando um servidor sai, espalhar as chaves dele por *todos* os outros em vez de despejá-las num único vizinho.

A simulação abaixo distribui 40.000 chaves de hold de assento em 5 nós. À esquerda, um ponto por nó contra 200 nós virtuais por nó; à direita, a fração de chaves que muda de dono quando um 6º nó entra:

```python exec="1" html="1"
import hashlib
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO
plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "xtick.color": "#888",
                     "ytick.color": "#888", "axes.edgecolor": "#888", "font.size": 10})

def h(s):  # stable 64-bit hash (Python's hash() changes between runs)
    return int.from_bytes(hashlib.md5(s.encode()).digest()[:8], "big")

keys = np.array([h(f"seat-hold:{i}") for i in range(40_000)], dtype=np.uint64)

def ring(nodes, vnodes):
    points = sorted((h(f"{n}#{v}"), n) for n in nodes for v in range(vnodes))
    return np.array([p for p, _ in points], dtype=np.uint64), [n for _, n in points]

def owners(nodes, vnodes):
    pos, names = ring(nodes, vnodes)
    idx = np.searchsorted(pos, keys) % len(pos)  # first point clockwise from the key
    return np.array(names)[idx]

nodes5 = [f"node{i}" for i in range(1, 6)]
nodes6 = nodes5 + ["node6"]

fig, (a, b) = plt.subplots(1, 2, figsize=(11, 4))

# left: share of keys per node with 1 point per node vs 200 virtual nodes
x = np.arange(len(nodes5))
for off, v, c in [(-0.2, 1, "#e5484d"), (0.2, 200, "#1e9e5a")]:
    own = owners(nodes5, v)
    share = [np.mean(own == n) * 100 for n in nodes5]
    a.bar(x + off, share, width=0.4, color=c, label=f"{v} point(s) per node (max {max(share):.0f}%)")
a.axhline(20, color="#888", linestyle="--", linewidth=1)
a.set_xticks(x, nodes5)
a.set_ylabel("share of keys (%)")
a.set_title("5 nodes: ideal share is 20%")
a.legend(frameon=False, fontsize=8)

# right: keys that change node when a 6th node is added
mod5 = keys % np.uint64(5)
mod6 = keys % np.uint64(6)
moved = {
    "hash mod N": np.mean(mod5 != mod6) * 100,
    "consistent\nhashing": np.mean(owners(nodes5, 200) != owners(nodes6, 200)) * 100,
    "ideal\n1/(N+1)": 100 / 6,
}
b.bar(list(moved), list(moved.values()), color=["#e5484d", "#2f6fed", "#888"])
for i, val in enumerate(moved.values()):
    b.text(i, val + 1.5, f"{val:.0f}%", ha="center")
b.set_ylabel("keys remapped (%)")
b.set_title("Adding a 6th node")
b.set_ylim(0, 100)

plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True, bbox_inches="tight")
print(buf.getvalue())
plt.close()
```

Duas lições da figura. Com um único ponto por nó, um nó fica com cerca de **metade** de todas as chaves e outro com quase nenhuma — o anel fica muito desequilibrado. Com 200 nós virtuais, todo nó fica perto dos 20% ideais. E, quando o 6º nó chega, `hash mod N` remapeia cerca de **83%** das chaves (5/6 delas, como a teoria prevê), enquanto o anel remapeia cerca de **17%** — o 1/6 que o novo nó precisa assumir de qualquer jeito.

O hashing consistente aparece em todo lugar em system design: `hash $key consistent` do Nginx, o ring hash e os balanceadores Maglev do Envoy, clientes de memcached, o Dynamo da Amazon e o Cassandra para particionar dados (estudado em [Bancos de dados — particionamento](../../databases/partitioning/index.md)), e servidores de chat no estilo do Discord que fixam um canal num nó.

!!! warning "Hashing consistente não resolve hot keys"
    Ele equilibra *muitas* chaves. Se uma chave é muito popular — o mapa de assentos do show no estádio —, todas as requisições dela ainda vão para um único nó. Hot keys precisam de outras ferramentas: cache, replicar a chave quente ou dividi-la.

---

## Service discovery: como o LB conhece as réplicas { #service-discovery }

Réplicas vêm e vão — o autoscaling as adiciona às 09:58, um deploy as substitui, um crash remove uma — e os seus endereços IP mudam toda vez. Antes de o load balancer poder escolher uma réplica saudável, alguém precisa contar a ele **quais réplicas existem agora**. Isso é **service discovery**, e ele tem dois formatos:

``` diagram-sim
flowchart LR
    subgraph server ["Discovery no servidor"]
        C1([gateway]) -->|"inventory.svc"| LB1["load balancer / kube-proxy"]
        LB1 --> R1[inventory-1]
        LB1 --> R2[inventory-2]
        REG1[("registry<br/>(endpoints do K8s)")] -.->|"watch"| LB1
    end
    subgraph client ["Discovery no cliente"]
        C2([gateway]) -->|"1 · quem atende inventory?"| REG2[("registry<br/>(Consul, Eureka)")]
        REG2 -->|"2 · [10.0.1.7, 10.0.2.9]"| C2
        C2 -->|"3 · escolhe uma sozinho"| R3[inventory-3]
    end
```

| | Discovery no servidor | Discovery no cliente |
|---|---|---|
| **Quem escolhe a réplica** | um load balancer ou proxy no caminho | o próprio serviço chamador, com uma biblioteca cliente |
| **Registry** | a plataforma (endpoints do Kubernetes, target groups da nuvem) | Consul, Eureka, etcd, registros DNS SRV |
| **Salto extra** | sim (o proxy) | não |
| **Acoplamento à linguagem** | nenhum: qualquer cliente só chama um nome | cada linguagem precisa da biblioteca (ou um sidecar faz isso — o service mesh) |
| **Típico hoje** | `Service` do Kubernetes + DNS, LBs de nuvem | clientes gRPC com xDS, service meshes, stacks antigas de Spring Cloud Netflix |

O registro é feito pela plataforma (o Kubernetes adiciona o IP de um pod aos endpoints do Service quando a probe de **readiness** passa) ou pela própria instância (ela se registra ao subir e envia heartbeats; um heartbeat perdido a remove). De um jeito ou de outro, discovery e **health checks** são duas metades da mesma pergunta — *quais réplicas conseguem atender agora?* — e o registry é um store pequeno e fortemente consistente (etcd, o Raft do Consul), pelos motivos vistos em [Sistemas distribuídos — consenso](../../distributed/consensus/index.md).

---

## Health checks { #health-checks }

Um load balancer só é tão bom quanto o que ele sabe sobre quais backends estão saudáveis. Há duas formas complementares de descobrir:

| Tipo | Como | Reage a | Exemplo |
|---|---|---|---|
| **Ativo** | o LB sonda cada backend periodicamente (`GET /actuator/health/readiness` a cada 5 s; 2 falhas → não saudável; 3 sucessos → saudável de novo) | backends que caíram, travaram ou ainda não estão prontos, mesmo sem tráfego | target groups da AWS, `health_check` do Nginx Plus, `check` do HAProxy, readiness probes do Kubernetes |
| **Passivo** (outlier detection) | o LB observa as respostas reais; um backend que devolve muitos 5xx ou timeouts é ejetado por um tempo | backends que passam na sonda mas falham nas requisições reais | outlier detection do Envoy, `max_fails` / `fail_timeout` do Nginx |

Projete o endpoint de saúde com cuidado. A **readiness** ("consigo atender tráfego agora?") deve verificar o que a instância precisa para responder às requisições — mas, se ela verificar uma dependência *compartilhada*, como o banco de dados, uma oscilação do banco marca **todas** as réplicas como não saudáveis ao mesmo tempo, e o LB fica sem nada para onde rotear. O meio-termo usual: a readiness reflete o estado da própria instância (iniciada, aquecida, não sobrecarregada, não em desligamento); falhas de dependências são tratadas com timeouts e circuit breakers ([Confiabilidade — padrões](../../reliability/patterns/index.md)).

### Connection draining { #draining }

Quando uma réplica é removida — por scale-in ou substituída por um deploy —, cortá-la de repente faz falhar toda requisição em andamento. O **connection draining** (deregistration delay) resolve isso: o LB para de mandar requisições *novas* para a réplica, espera as que estão em andamento terminarem (até, digamos, 30 s) e só então a remove. No Kubernetes, o pod passa a *not ready*, é removido dos endpoints do Service e recebe `SIGTERM`; a aplicação deve terminar as requisições em curso antes de sair (Spring Boot: `server.shutdown=graceful`).

---

## Sticky sessions { #sticky-sessions }

A **afinidade de sessão** ("sticky sessions") faz o LB mandar toda requisição de um mesmo cliente para o mesmo backend, usando um cookie definido pelo LB ou um hash do IP do cliente. Ela existe para aplicações que guardam estado em memória — uma sessão no servidor, um cache no processo, um WebSocket.

| | Sticky sessions | Réplicas stateless + store compartilhado |
|---|---|---|
| Onde o estado fica | na memória de uma réplica | Redis / banco de dados / token no cliente (JWT) |
| Uma réplica morre | os usuários dela perdem a sessão | nada se perde |
| Equilíbrio | desigual: usuários pesados ficam presos a uma réplica | qualquer réplica atende qualquer requisição |
| Scale-in / deploys | é preciso esperar as sessões acabarem ou perdê-las | drenagem em segundos |
| Custo extra | nenhum | uma chamada de rede ao store compartilhado |

Prefira **réplicas stateless**. Use afinidade só onde o estado é inerentemente local e barato de reconstruir — uma conexão WebSocket, um cache local que só melhora o hit ratio — e prefira **hashing consistente** sobre uma chave com significado (id do usuário, id da sala) à afinidade por cookie, porque ele sobrevive a reinícios do LB e escala suavemente.

---

## O load balancer não pode ser o ponto fraco { #lb-ha }

Um único load balancer na frente de dez réplicas é um **ponto único de falha**. Como o próprio LB se mantém no ar depende de quem o opera:

- **Load balancers gerenciados de nuvem** (ALB/NLB, Google Cloud Load Balancing, Azure Load Balancer) são sistemas distribuídos operados pelo provedor em várias zonas de disponibilidade; você recebe um nome DNS ou um IP, e o provedor escala e substitui as máquinas por baixo.
- **Auto-hospedados** (Nginx, HAProxy, Envoy em VMs): rode pelo menos dois, num **par ativo-passivo** que compartilha um **IP virtual** (VIP), movido por VRRP (keepalived) quando o ativo falha, ou **ativo-ativo** atrás de DNS ou de uma camada L4.
- **Anycast** na borda: o mesmo IP anunciado de muitos locais ([DNS & CDN](../dns-cdn/index.md#anycast)).

Há também uma hierarquia de escopos: um load balancer **global** (anycast ou baseado em DNS) escolhe a **região**; um load balancer **regional** escolhe a **zona e a instância**; dentro do Kubernetes, o Service e o ingress escolhem o **pod**.

``` diagram
flowchart TB
    u([Fãs no mundo todo]) --> g["LB global / DNS<br/>escolhe a região"]
    g --> r1["LB regional São Paulo<br/>em 3 zonas"]
    g --> r2["LB regional Virgínia"]
    r1 --> i1["Ingress / Gateway<br/>no cluster"]
    i1 --> p1[pods de inventory]
    i1 --> p2[pods de order]
```

**Experimente.** Carregue o cenário scale-out e rode o perfil **load** com 2 réplicas; anote a latência p99 e os erros. Aumente o número de réplicas até o p99 se estabilizar. Depois derrube uma réplica com o teste rodando (chaos **medium**, ou pare-a no painel): veja os health checks a removerem, o pico de erros que dura até isso acontecer, e as réplicas restantes absorverem a carga. Experimente outro algoritmo de balanceamento e compare o p99.

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-height="520" data-profile="load"></div>

[:material-open-in-new: Abrir o playground completo](../../../../playground/index.md)

---

## Um load balancer na prática: Nginx { #nginx }

O [Hands-on 3](../../../hands-on/3/index.md) coloca o Nginx na frente de três réplicas de `catalog`. O núcleo da configuração é um bloco `upstream` — o pool de réplicas e o algoritmo: round robin por padrão, ou uma linha como `least_conn;`, `random two least_conn;` (power of two choices) ou `hash $arg_event consistent;` — e um `location` que faz proxy para ele.

!!! example "No código do BoxOffice: o load balancer da borda (lab 3)"

    Esta é a configuração do [Hands-on 3](../../../hands-on/3/index.md), sem alterações. Além do pool, veja o que protege os fãs de uma réplica ruim: `max_fails=3 fail_timeout=10s` é um health check **passivo** (3 requisições com falha tiram uma réplica por 10 s); `proxy_connect_timeout 1s` e `proxy_read_timeout 5s` limitam quanto tempo uma réplica morta ou congelada pode segurar uma requisição; `proxy_next_upstream` refaz uma requisição que falhou **mais uma vez** (`tries 2`) em outra réplica; `keepalive 64` reaproveita as conexões com as réplicas. `least_conn` está comentado de propósito: o lab pede que você o ligue e compare a cauda. No experimento de falhas do lab, a 150 req/s, uma réplica parada não custou quase nada, enquanto uma congelada não produziu erros, mas um p99 de 1 s e um máximo de 5,05 s — o read timeout.

    ``` { .nginx title="infra/nginx/nginx.conf (pool, timeouts, retry)" }
    --8<-- "docs/2027.1/hands-on/3/code/infra/nginx/nginx.conf:19:26,43:61"
    ```

Note o que é configurado além do algoritmo: **timeouts** em direção aos backends, conexões **keep-alive** com eles e **`proxy_next_upstream`**, que refaz uma requisição que falhou em outra réplica. O Nginx não refaz requisições não idempotentes (como `POST`) por padrão — refazer um `POST /holds` em outra réplica poderia criar dois holds. Os timeouts vêm de medição, não de gosto: um read timeout menor que o p99 saudável transforma respostas lentas em retries, e o lab usa 5 s para um serviço cujas listagens levam centenas de milissegundos sob carga.

---

## Balanceamento de carga no Kubernetes { #kubernetes }

No Kubernetes, três objetos dividem o trabalho de balanceamento.

**Service** — um IP virtual e um nome DNS estáveis (`inventory.boxoffice.svc.cluster.local`) na frente dos pods que casam com um label selector. Só os pods **ready** aparecem como endpoints. O tráfego para o IP do Service é distribuído entre eles em L4, pelo `kube-proxy` (regras iptables/IPVS) ou por um data plane eBPF como o Cilium. Um Service do tipo `LoadBalancer` também pede ao provedor de nuvem um load balancer L4 externo.

```yaml title="inventory-service.yaml"
apiVersion: v1
kind: Service
metadata:
  name: inventory
spec:
  selector:
    app: inventory
  ports:
    - port: 80
      targetPort: 8080
```

**Ingress** — a API original para **roteamento HTTP em L7** para dentro do cluster: regras por host e path e terminação TLS, tudo implementado por um **ingress controller** (Traefik, HAProxy, controllers de nuvem; o controller comunitário `ingress-nginx` foi muito popular, mas foi aposentado pelo projeto Kubernetes). A API Ingress é simples, mas limitada: qualquer coisa além de roteamento por host/path (match de headers, divisão de tráfego, timeouts) exige anotações específicas de cada controller, que não são portáveis.

```yaml title="ingress.yaml"
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: boxoffice
spec:
  ingressClassName: traefik
  tls:
    - hosts: [api.boxoffice.com]
      secretName: boxoffice-tls
  rules:
    - host: api.boxoffice.com
      http:
        paths:
          - path: /api/holds
            pathType: Prefix
            backend:
              service:
                name: inventory
                port:
                  number: 80
```

**Gateway API** — a sucessora do Ingress, com disponibilidade geral desde 2023[^4]. Ela divide a configuração por **papel**, para que cada time seja dono da sua parte:

| Recurso | Dono | Define |
|---|---|---|
| `GatewayClass` | provedor de infraestrutura | qual implementação (Envoy Gateway, Istio, Cilium, NGINX Gateway Fabric, gateways de nuvem) |
| `Gateway` | operadores da plataforma / do cluster | listeners: portas, protocolos, hostnames, certificados TLS |
| `HTTPRoute` (e `GRPCRoute`, `TLSRoute`, …) | times de aplicação | regras de roteamento: match de path, header e método, pesos, filtros, timeouts |

Recursos que exigiam anotações no Ingress fazem parte do padrão: **divisão de tráfego por peso** (canaries), roteamento por header, espelhamento de requisições, timeouts e roteamento gRPC.

```yaml title="gateway.yaml"
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: public
spec:
  gatewayClassName: envoy
  listeners:
    - name: https
      protocol: HTTPS
      port: 443
      hostname: api.boxoffice.com
      tls:
        certificateRefs:
          - name: boxoffice-tls
---
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: inventory
spec:
  parentRefs:
    - name: public
  rules:
    - matches:
        - path:
            type: PathPrefix
            value: /api/holds
      timeouts:
        request: 2s
      backendRefs:
        - name: inventory        # stable version: 95% of requests
          port: 80
          weight: 95
        - name: inventory-canary # new version: 5% of requests
          port: 80
          weight: 5
```

No [hands-on 10](../../../hands-on/10/index.md) você implanta o BoxOffice num cluster local e o expõe por um ingress; releases canary voltam na [aula de cloud-native](../../cloud-native/index.md).

---

## Trade-offs num relance { #trade-offs }

| Decisão | Opção A | Opção B | Escolha A quando… |
|---|---|---|---|
| Camada | L4 | L7 | você precisa de throughput bruto, protocolos não HTTP ou TLS pass-through |
| Algoritmo | round robin | least connections / P2C | requisições e servidores são uniformes |
| Afinidade | hashing consistente sobre uma chave | nenhuma (stateless) | um backend guarda estado útil por chave (cache, sala, shard) |
| Health checks | só ativos | ativos + passivos (outlier detection) | o tráfego é baixo e as falhas são crashes limpos |
| Operação | LB gerenciado de nuvem | Nginx / HAProxy / Envoy auto-hospedado | você está numa nuvem e quer HA e escala resolvidos para você |
| Kubernetes | Ingress | Gateway API | um setup simples e já existente; projetos novos devem preferir a Gateway API |

!!! example "BoxOffice: balanceando a carga do núcleo"
    - Um **load balancer L7 regional gerenciado** termina o TLS de `api.boxoffice.com`, distribui as requisições por três zonas de disponibilidade e as encaminha ao **Gateway** do Kubernetes (Envoy Gateway), que roteia por path: `/api/events/**` → `catalog`, `/api/holds/**` → `inventory`, `/api/orders/**` → `order`.
    - Algoritmo: **P2C sobre requisições em andamento** (least-request, o padrão do Envoy Gateway), porque o custo das requisições de hold varia quando há contenção de locks nos setores populares.
    - Saúde: readiness probes em `/actuator/health/readiness` (só o estado da instância) mais **outlier detection** que ejeta por 30 s um pod que devolve 5 respostas 5xx seguidas.
    - Serviços stateless: os holds ficam no PostgreSQL, as sessões são JWTs; **sem sticky sessions**. A única exceção é o serviço de WebSocket/SSE da sala de espera, onde as conexões são de longa duração e balanceadas no momento da conexão.
    - Deploys: graceful shutdown (30 s) e uma rota **canary** com peso de 5% antes do dia da venda.

!!! tip "Na entrevista"
    - Desenhe o load balancer **na frente de toda camada stateless** e diga "os servidores de aplicação são stateless, então o LB pode mandar qualquer requisição para qualquer lugar" — isso justifica a escala horizontal.
    - Cite o **algoritmo** só quando ele importa: least connections / P2C para custos de requisição desiguais; **hashing consistente** quando as requisições devem chegar ao servidor que guarda os seus dados (nós de cache, salas de chat, shards). Conheça a propriedade 1/(N+1) e por que os nós virtuais existem.
    - Mencione **health checks** e **draining** quando perguntarem sobre falhas ou deploys.
    - Se perguntarem "o LB não é um ponto único de falha?": LBs gerenciados são replicados entre zonas; os auto-hospedados rodam como um par ativo-passivo com um IP flutuante, ou atrás de anycast/DNS.

!!! success "Boas práticas"

    - **Defina os timeouts dos backends a partir da latência medida, um pouco acima do p99,9 saudável** — menor transforma respostas lentas em retries, maior deixa uma réplica congelada segurar requisições. No BoxOffice: `proxy_read_timeout 5s` no [lab 3](../../../hands-on/3/index.md) (quadro acima).
    - **Aqueça uma réplica nova antes de ela receber a sua parte inteira** — slow start ou uma readiness que espera o warm-up; uma JVM fria marcada como falha sob carga pode virar uma cascata de `502 no live upstreams` (lab 3, passo 7).
    - **Use least connections ou power of two choices quando o custo das requisições varia** — o round robin ignora uma réplica presa a requisições lentas. No BoxOffice: experimente `least_conn;` no upstream do lab 3.
    - **Reaproveite as conexões com os backends** — o keep-alive evita um handshake TCP (e TLS) por requisição. No BoxOffice: `keepalive 64` com `proxy_http_version 1.1` no lab 3.
    - **Registre no log o backend escolhido e o tempo dele em toda requisição** — `upstream=$upstream_addr ut=$upstream_response_time` no formato de log do lab 3 mostra qual réplica está lenta e quanto o salto custa.

!!! warning "Armadilhas"
    - **Réplicas com estado atrás de um LB round robin**: logins "somem aleatoriamente" porque a sessão está em outra réplica. Externalize o estado.
    - **Readiness que verifica dependências compartilhadas**: uma oscilação do banco ejeta todas as réplicas de uma vez.
    - **Balanceamento L4 de conexões HTTP/2 ou gRPC de longa duração**: todo o tráfego gruda nas primeiras réplicas; réplicas novas não recebem nada depois de um scale-out.
    - **Refazer requisições não idempotentes no LB**: holds ou pedidos duplicados.
    - **Sem draining**: todo deploy causa uma rajada de 502s.
    - **Esquecer os limites do próprio LB**: tabelas de conexões, handshakes TLS por segundo e banda são finitos; LBs gerenciados também podem precisar de pré-aquecimento antes de um pico conhecido — fale com o provedor antes da venda.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    SD["service discovery"] --> LB["load balancer"]
    HC["health checks<br/>(readiness)"] --> LB
    LB --> ALG["algoritmo: RR, least conn,<br/>P2C, hashing consistente"]
    ALG --> STATELESS["réplicas stateless<br/>→ Computação"]
    ALG --> CH["hashing consistente<br/>→ sharding (aula 6)"]
    LB --> HA["redundância do LB, anycast<br/>→ Confiabilidade"]
    LB --> K8S["Service, Ingress, Gateway API<br/>→ Cloud-native"]
    STATELESS --> AS["autoscaling<br/>→ Computação"]
    HC --> OBS["endpoints de saúde<br/>→ Observabilidade"]
```

**Componentes da paleta:** [`lb`](../../../reference/components/edge/index.md#lb) · [`ingress`](../../../reference/components/edge/index.md#ingress) · [`app`](../../../reference/components/compute/index.md#app) (as réplicas atrás dele) · [`healthcheck`](../../../reference/components/observability/index.md#healthcheck) · [`mesh`](../../../reference/components/network/index.md#mesh) (balanceamento no cliente, num sidecar). **Cenários:** `scale-out`, `chat` (conexões de longa duração). **Continua em:** [Computação — serviços](../../compute/services/index.md), [Bancos de dados — particionamento](../../databases/partitioning/index.md) (hashing consistente para dados), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Hands-on 3](../../../hands-on/3/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Um load balancer transforma um pool de réplicas **stateless** e intercambiáveis num único serviço escalável e altamente disponível.
    - **L4** balanceia conexões (rápido, indiferente ao protocolo); **L7** balanceia requisições (roteamento, TLS, retries, decisões por requisição).
    - Round robin para trabalho uniforme; **least connections / power of two choices** para trabalho desigual; **hashing consistente com nós virtuais** quando uma chave precisa ficar presa a um servidor — adicionar um nó move só cerca de **1/(N+1)** das chaves.
    - **Health checks ativos e passivos** removem réplicas com falha; o **draining** torna os deploys invisíveis.
    - Evite sticky sessions; mantenha o estado num store compartilhado.
    - No Kubernetes: **Service** (L4, pods ready), **Ingress** (L7 básico) e **Gateway API** (roteamento L7 por papéis e portável, com pesos e timeouts).

---

[^1]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/load-balancing-frontend/){target="_blank"}, cap. 19 "Load Balancing at the Frontend" e cap. 20 "Load Balancing in the Datacenter". O'Reilly, 2016.
[^2]: MITZENMACHER, M. [The Power of Two Choices in Randomized Load Balancing](https://www.eecs.harvard.edu/~michaelm/postscripts/tpds2001.pdf){target="_blank"}. IEEE Transactions on Parallel and Distributed Systems, 2001.
[^3]: KARGER, D. et al. [Consistent Hashing and Random Trees](https://dl.acm.org/doi/10.1145/258533.258660){target="_blank"}. ACM STOC, 1997.
[^4]: KUBERNETES SIG NETWORK. [Gateway API](https://gateway-api.sigs.k8s.io/){target="_blank"}. Documentação do Kubernetes.
[^5]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1, cap. 5 "Design consistent hashing". Byte Code LLC, 2020.
