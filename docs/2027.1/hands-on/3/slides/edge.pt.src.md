---
marp: true
lang: pt-BR
title: Lab 3 — Borda
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 3</div>

# Lab 3 — Borda

**Nginx como proxy reverso, balanceador de carga e rate limiter sobre três réplicas do `catalog`**

<!--
Roteiro: (1) por que escalar horizontalmente; (2) a topologia; (3) réplicas no Compose; (4) nginx.conf;
(5) distribuição; (6) falhas: stop vs pause; (7) rate limiting; (8) medir a eficiência do scale-out.
-->

---

## Uma réplica são dois problemas

<div class="q">

O `catalog` satura em ~400 req/s e um deploy o derruba. O que resolve os dois de uma vez?

</div>

- **Capacidade**: mais cópias idênticas dividem a carga.
- **Disponibilidade**: uma cópia falha, as outras continuam atendendo.
- Pré-condição: o serviço é **stateless**.

---

## A topologia

```text
k6 ──► edge :80 (Nginx) ──► catalog-1 ┐
                         ├─► catalog-2 ├──► db
                         └─► catalog-3 ┘
```

- Só a borda publica uma porta; as réplicas são privadas.
- Cabeçalho `X-Instance`: qual réplica respondeu.

---

## Três réplicas com uma âncora

```yaml
x-catalog: &catalog
  build: ./services/catalog
  image: boxoffice-catalog
  deploy: { resources: { limits: { cpus: "1.0", memory: 768M } } }

services:
  catalog-1: { <<: *catalog, hostname: catalog-1 }
  catalog-2: { <<: *catalog, hostname: catalog-2 }
  catalog-3: { <<: *catalog, hostname: catalog-3 }
```

---

## O upstream

```nginx
upstream catalog {
    zone catalog 64k;
    server catalog-1:8082 resolve max_fails=3 fail_timeout=10s;
    server catalog-2:8082 resolve max_fails=3 fail_timeout=10s;
    server catalog-3:8082 resolve max_fails=3 fail_timeout=10s;
    keepalive 64;
}
```

- Round robin por padrão; `least_conn` a uma linha de distância.
- `resolve`: sobe mesmo com uma réplica fora do ar; retoma-a quando ela volta.

---

## Timeouts e retries

```nginx
proxy_connect_timeout  1s;
proxy_read_timeout     5s;
proxy_next_upstream    error timeout http_502 http_503 http_504;
proxy_next_upstream_tries  2;
```

- GET que falhou → repetido em outra réplica.
- POST **não** é repetido por padrão: pode não ser idempotente.

---

## Morta vs congelada

| Falha | O Nginx vê | O cliente vê |
|---|---|---|
| `stop` | conexão recusada → retry na hora | ~nada |
| `pause` | sem resposta por 5 s → retry | p99 ≈ **5 s** |
| 3 falhas | fora do rodízio por 10 s | normal de novo |

<div class="warn">

Uma réplica **morta** é fácil. Uma **lenta** é perigosa: o timeout decide quanto ela custa.

</div>

---

## Health checks passivos vs ativos

- **Passivos** (Nginx open source): aprendem com requisições reais que falharam.
- **Ativos** (Envoy, HAProxy, LBs da nuvem, readiness do Kubernetes): sondam `/actuator/health/readiness`.
- Readiness ≠ liveness: *pode atender* vs *está viva*.

<div class="q">

Por que não `proxy_read_timeout 100ms` para pegar réplicas congeladas na hora?

</div>

---

## Rate limiting na borda

```nginx
limit_req_zone  $http_x_api_key  zone=per_key:10m  rate=20r/s;
limit_req  zone=per_key  burst=40  nodelay;
limit_req_status  429;
```

| Cliente | Enviadas (30 s) | 200 | 429 |
|---|---|---|---|
| greedy, 50 req/s | 1.500 | ~640 | ~860 |
| polite, 10 req/s | 300 | 300 | 0 |

---

## Quem é o cliente?

- Um cabeçalho escolhido pelo cliente pode ser **trocado** por um atacante.
- Limites reais: identidades verificadas (chaves de API emitidas, `sub` do JWT) **mais** limite por IP para tráfego anônimo.
- Limite por IP erra atrás de NAT — e estrangula o nosso k6 de um único IP.

---

## Meça: 1 vs 3 réplicas, duas cargas

| Carga | Gargalo | 3 réplicas dão |
|---|---|---|
| só detalhes (`LIST_SHARE=0`) | CPU da réplica | perto de 3× |
| mistura do lab 2 (20% listagens) | **PostgreSQL** | pouco — ou pior |

<div class="ok">

Eficiência de escala = capacidade(3) / (3 × capacidade(1)). Olhe o `docker stats`: quem está em 100%?

</div>

---

## Por que não 3×?

- Mistura: `db` em ~670% de CPU, cada réplica em ~20% — a camada compartilhada está saturada.
- Mais réplicas = mais consultas pesadas simultâneas no **mesmo** banco.
- Réplicas frias + `max_fails` podem cascatear até `502 no live upstreams`: **aqueça** antes.

---

## Pontos-chave

1. Serviços stateless escalam atrás de um **balanceador de carga**; o estado fica em outro lugar.
2. A borda é a única porta pública: roteamento, balanceamento, limites, ids de requisição.
3. Os **timeouts** transformam réplicas lentas em retries; defina-os pela latência medida.
4. Só faça retry de requisições **idempotentes**.
5. Rate limits protegem todos de um único cliente — use uma identidade **verificada** como chave.
6. Escalar a camada stateless passa a pressão para a camada stateful **compartilhada**.
