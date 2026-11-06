---
marp: true
lang: pt-BR
title: Hands-on 7 — Balanceador de carga
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 7</div>

# Hands-on 7 — Balanceador de carga

**Colocar o Nginx na frente do gateway e escalá-lo horizontalmente**

<!--
Roteiro: (1) por que um único gateway é um gargalo; (2) forward × proxy reverso; (3) L4 × L7, algoritmos;
(4) nginx.conf; (5) compose: nginx + réplicas do gateway; (6) executar, verificar, escalar em tempo de execução.
-->

---

## Um gateway para tudo

<div class="q">

Todo o tráfego externo entra por uma **única instância do gateway**. O que acontece sob carga contínua?

</div>

* Um processo, um pool de threads, **nenhuma redundância** — o gateway vira o **gargalo**.
* Se ele cair, a **plataforma inteira** fica inacessível.
* A solução: rodar **várias instâncias idênticas** e espalhar as requisições — **escalonamento horizontal**.

<!--
Pergunte primeiro. O balanceador de carga é o que faz "várias instâncias idênticas" parecerem um só serviço.
-->

---

## Forward × proxy reverso

<div class="cols">
<div>

### Forward proxy

Fica na frente dos **clientes**. O servidor vê o endereço do proxy, não o do cliente.

Firewalls corporativos, filtragem de conteúdo, VPN, Tor.

</div>
<div>

### Proxy reverso

Fica na frente dos **servidores**. O cliente vê só o proxy, nunca os backends.

Balanceamento de carga, terminação SSL, cache, rate limiting.

</div>
</div>

<div class="ok">

Aqui o **Nginx é um proxy reverso**: o único componente exposto, espalhando o tráfego por réplicas do gateway que os clientes nunca veem.

</div>

---

## Camada 4 × Camada 7

| | Camada 4 — Transporte | Camada 7 — Aplicação |
|---|---|---|
| Roteia por | endereço IP e porta TCP/UDP | caminho da URL, cabeçalhos, cookies, corpo |
| Inspeciona HTTP? | não — encaminha fluxos de bytes | sim — pode reescrever requisições e respostas |
| Velocidade | custo mínimo, extremamente rápido | pequeno custo, desprezível na maioria dos casos |
| Permite | qualquer protocolo TCP/UDP | sticky sessions, A/B, roteamento por caminho |
| Exemplos | AWS NLB, HAProxy em modo TCP | **Nginx**, Traefik, AWS ALB |

---

## Algoritmos de balanceamento

| Algoritmo | Comportamento | Indicado para |
|---|---|---|
| **Round Robin** | um por servidor, em ordem | workloads uniformes, réplicas iguais |
| **Least Connections** | servidor com menos conexões ativas | requisições longas ou variáveis |
| **IP Hash** | o IP do cliente escolhe o servidor | afinidade de sessão (apps com estado) |
| **Weighted Round Robin** | fatia proporcional a um peso | servidores de capacidades diferentes |
| **Random** | servidor escolhido ao acaso | clusters muito grandes |

---

## Arquitetura

<div class="flow">
<div class="arrow" style="flex: .45; text-align: left">Antes</div>
<div class="box muted">internet</div><div class="arrow">:8080 →</div>
<div class="box red">gateway<small>exposto diretamente · uma instância</small></div><div class="arrow">→</div>
<div class="box">auth, account<small>→ banco de dados</small></div>
</div>
<div class="flow" style="align-items: stretch">
<div class="arrow" style="flex: .45; text-align: left; align-self: center">Depois</div>
<div class="box muted" style="display: flex; flex-direction: column; justify-content: center">internet</div><div class="arrow" style="align-self: center">:8080 →</div>
<div class="box accent" style="display: flex; flex-direction: column; justify-content: center">lb · Nginx :80<small>o único componente exposto</small></div><div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">sem portas publicadas</div>
<div class="box green">gateway-1</div><div class="box green">gateway-2</div><div class="box green">gateway-3</div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="box" style="display: flex; flex-direction: column; justify-content: center">auth, account<small>→ banco de dados</small></div>
</div>

Passos: **1** `nginx.conf` → **2** `compose.yaml` (`lb` + réplicas do gateway) → **3** executar e verificar.

---

## 1 · `setup/nginx.conf`

```nginx
http {
    upstream gateways {
        server gateway:8080;
    }
    server {
        listen 80;
        location / {
            proxy_pass         http://gateways;
            proxy_set_header   X-Real-IP $remote_addr;
            proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        }
    }
}
```

<p class="small">Trecho; o arquivo também define <code>Host</code> e <code>X-Forwarded-Proto</code>, além de <code>events { worker_connections 1024; }</code>.</p>

---

## Diretivas principais

| Diretiva | Finalidade |
|---|---|
| `upstream gateways` | o pool de backends; o sistema de nomes de domínio (DNS, *Domain Name System*) do Docker expande `gateway:8080` para **os IPs de todas as réplicas** |
| _(sem linha de algoritmo)_ | **Round Robin** padrão; `least_conn;` mandaria a próxima requisição → menos conexões ativas |
| `proxy_pass` | encaminha a requisição para o pool upstream |
| `X-Real-IP` | IP original do cliente para o backend |
| `X-Forwarded-For` | acrescenta o IP do cliente à cadeia de encaminhamento (logs, auditoria) |
| `X-Forwarded-Proto` | se a requisição original era HTTP ou HTTPS |

<p class="small">Algoritmo dentro do <code>upstream</code>: nenhum = Round Robin · <code>least_conn;</code> · <code>ip_hash;</code> · <code>random;</code> · <code>server gateway:8080 weight=3;</code></p>

---

## 1 · Como o Nginx encontra as réplicas

<div class="flow">
<div class="box">Compose<small>sobe 3 réplicas do gateway</small></div><div class="arrow">→</div>
<div class="box accent">DNS do Docker<small>gateway → o IP de cada réplica</small></div><div class="arrow">uma vez, ao iniciar →</div>
<div class="box green">upstream gateways<small>3 peers</small></div><div class="arrow">--scale 5 →</div>
<div class="box orange">ainda 3 peers<small>réplicas 4 e 5 ociosas</small></div>
</div>

<div class="warn">

Réplicas adicionadas depois ficam **invisíveis** para o Nginx até ele resolver o nome de novo:
`docker compose exec lb nginx -s reload`

</div>

---

<!-- _class: tight -->

## 2 · Docker Compose

<div class="cols">
<div>

```yaml
  lb:
    image: nginx:latest
    ports:
      - "8080:80"
    volumes:
      - ./setup/nginx.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - gateway
```

</div>
<div>

```yaml
  gateway:
    build:
      context: ./gateway-service
      dockerfile: Dockerfile
    # ports removed
    deploy:
      replicas: 3
```

</div>
</div>

- O gateway **não tem `ports`** — só é acessível pelo `lb`. `depends_on`: o Nginx precisa achar o `gateway` ao iniciar.
- Remova `hostname: gateway`: um hostname não pode ir para vários containers. O nome de serviço `gateway` continua resolvendo.

<p class="small">Porta 8080 do host → Nginx (80): os clientes continuam chamando <code>http://localhost:8080</code>. O repositório mantém <code>replicas: 1</code>; use 3 para ver o balanceamento.</p>

---

## 3 · Executar e verificar

```bash
docker compose up -d --build
docker compose ps -a        # lb + gateway-1, -2, -3, no ports on the gateways
for i in {1..9}; do curl -s http://localhost:8080/health-check; echo; done
docker compose logs gateway --tail 30
```

- O `/health-check` responde o hostname da réplica: a saída alterna entre os três gateways.
- Todas as requisições em uma réplica? O Nginx subiu **antes** de as réplicas estarem prontas → `docker compose restart lb`.

---

## Escalar em tempo de execução

```bash
docker compose up -d --scale gateway=5     # add replicas, no rebuild
docker compose exec lb nginx -s reload     # re-query Docker DNS
docker compose ps gateway                  # confirm the count
docker compose up -d --scale gateway=1     # scale down
```

<p class="small">Depois de reduzir as réplicas e recarregar, o Nginx deixa de rotear para os containers que saíram. Antes do reload, ele ainda tenta os IPs deles: respostas mais lentas e um log cheio de tentativas falhas.</p>

---

## Quando uma réplica para

<div class="flow">
<div class="box">GET /health-check</div><div class="arrow">→</div>
<div class="box red">gateway-2 · parado<small>113: Host is unreachable</small></div><div class="arrow">próximo upstream →</div>
<div class="box green">gateway-3<small>200 ao cliente</small></div><div class="arrow">depois</div>
<div class="box orange">gateway-2 fora por 10 s<small>max_fails=1 · fail_timeout=10s</small></div>
</div>

- O `nginx.conf` do lab não define nenhum dos dois: são os **padrões** do Nginx, uma verificação de saúde **passiva**.
- 3 réplicas, uma parada: toda requisição respondida, uma requisição lenta a cada 10 s.
- 1 réplica, parada: **502 Bad Gateway** — ninguém para quem passar a requisição.

<!--
A página Executar tem os comandos (docker stop store-gateway-2, o loop, docker compose logs lb) e o diagrama passo a passo.
-->
---

## Sem Docker: o simulador

<div class="flow">
<div class="box accent">Run<small>3 respostas por réplica; --scale 5: ainda 3 até o reload</small></div>
<div class="box orange">Uma réplica para<small>9 respostas, 1 tentativa falha, 3,4 s</small></div>
<div class="box red">Uma réplica<small>parada: 502</small></div>
</div>

- As páginas embutem o lb e os gateways do lab: mesmo `nginx.conf`, mesmos comandos, mesmas saídas.
- O play roda uma página passo a passo; os botões funcionam a qualquer momento; experimente `ip_hash` ou `random`.

<!--
O simulador fica na visão geral (abrindo em Run) e em "Quando uma réplica para", na página Executar.
-->

---

## Pontos-chave

1. Um único gateway é um **gargalo** e um ponto único de falha; réplicas resolvem os dois.
2. O Nginx funciona como **proxy reverso**: o único componente exposto, escondendo os backends.
3. **L4** roteia por IP e porta; **L7** (Nginx) entende HTTP e roteia por caminho, cabeçalho ou cookie.
4. O algoritmo fica no bloco `upstream`: Round Robin por padrão, ou `least_conn;`, `ip_hash;`, `random;`.
5. O DNS do Docker transforma `gateway:8080` em **todos os IPs das réplicas** — mas o Nginx só resolve **na inicialização**.
6. Depois de escalar, **recarregue o Nginx** (`nginx -s reload`) para que ele veja as novas réplicas.
