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

<div class="cols">
<div>

### Antes

internet → `:8080` **gateway** → `auth`, `account` → banco de dados

O gateway é exposto diretamente.

</div>
<div>

### Depois

internet → `:80` **Nginx** → gateway ×3 → `auth`, `account` → banco de dados

Só o Nginx é acessível de fora da rede Docker.

</div>
</div>

Passos: **1** `nginx.conf` → **2** `compose.yaml` (nginx + réplicas do gateway) → **3** executar e verificar.

---

## 1 · `setup/nginx/nginx.conf`

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
| `upstream gateways` | o pool de backends; o DNS do Docker expande `gateway:8080` para **os IPs de todas as réplicas** |
| `least_conn;` | linha opcional de algoritmo no `upstream`: próxima requisição → menos conexões ativas |
| `proxy_pass` | encaminha a requisição para o pool upstream |
| `X-Real-IP` | IP original do cliente para o backend |
| `X-Forwarded-For` | acrescenta o IP do cliente à cadeia de encaminhamento (logs, auditoria) |
| `X-Forwarded-Proto` | se a requisição original era HTTP ou HTTPS |

<p class="small">Algoritmo dentro do <code>upstream</code>: nenhum = Round Robin · <code>least_conn;</code> · <code>ip_hash;</code> · <code>random;</code> · <code>server gateway:8080 weight=3;</code></p>

---

<!-- _class: tight -->

## 2 · Docker Compose

<div class="cols">
<div>

```yaml
  nginx:
    image: nginx:alpine
    hostname: nginx
    ports:
      - 8080:80
    volumes:
      - $SETUP/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
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
    depends_on:
      - account
      - auth
```

</div>
</div>

- `.env`: `SETUP=./setup`. O gateway **não tem `ports`** — só é acessível pelo Nginx.
- Remova `hostname: gateway`: um hostname não pode ir para vários containers. O nome de serviço `gateway` continua resolvendo.

<p class="small">O passo de execução acessa o Nginx em <code>http://localhost/</code> (porta 80 do host); com <code>8080:80</code>, use <code>http://localhost:8080/</code>.</p>

---

## Como o Nginx encontra as réplicas

1. O Compose sobe **3 réplicas** do `gateway`.
2. O DNS interno do Docker resolve o nome `gateway` para **o IP de cada réplica**.
3. O Nginx consulta esse registro **uma vez, na inicialização**, e monta o pool upstream.

<div class="warn">

Réplicas adicionadas depois ficam **invisíveis** para o Nginx até ele resolver o nome de novo:
`docker compose exec nginx nginx -s reload`

</div>

---

## 3 · Executar e verificar

```bash
docker compose up -d --build
docker compose ps -a        # nginx + gateway-1, -2, -3, no ports on the gateways
for i in {1..9}; do curl -s -o /dev/null http://localhost/gateway/actuator/health; done
docker compose logs gateway --tail 30
```

- Cada um dos três containers do gateway deve mostrar entradas de requisição.
- Todas as requisições em uma réplica? O Nginx subiu **antes** de as réplicas estarem prontas → `docker compose restart nginx`.

---

## Escalar em tempo de execução

```bash
docker compose up -d --scale gateway=5     # add replicas, no rebuild
docker compose exec nginx nginx -s reload  # re-query Docker DNS
docker compose ps gateway                  # confirm the count
docker compose up -d --scale gateway=1     # scale down
```

<div class="ok">

Se uma réplica cair, o Docker a reinicia e o Nginx continua roteando para as saudáveis: a falha é **transparente para os clientes**.

</div>

---

## Pontos-chave

1. Um único gateway é um **gargalo** e um ponto único de falha; réplicas resolvem os dois.
2. O Nginx funciona como **proxy reverso**: o único componente exposto, escondendo os backends.
3. **L4** roteia por IP e porta; **L7** (Nginx) entende HTTP e roteia por caminho, cabeçalho ou cookie.
4. O algoritmo fica no bloco `upstream`: Round Robin por padrão, ou `least_conn;`, `ip_hash;`, `random;`.
5. O DNS do Docker transforma `gateway:8080` em **todos os IPs das réplicas** — mas o Nginx só resolve **na inicialização**.
6. Depois de escalar, **recarregue o Nginx** (`nginx -s reload`) para que ele veja as novas réplicas.
