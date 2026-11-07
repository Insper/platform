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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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

O `catalog` sai da meta de latência em algumas centenas de req/s (o joelho do lab 2) e um deploy o derruba. O que resolve os dois de uma vez?

</div>

- **Capacidade**: mais cópias idênticas dividem a carga.
- **Disponibilidade**: uma cópia falha, as outras continuam atendendo.
- Pré-condição: o serviço é **stateless**.

---

## A topologia

<div class="flow">
<div class="box muted" style="flex: .6">k6 / fãs</div><div class="arrow">:80 →</div>
<div class="box accent">edge<small>Nginx 1.30 · a única porta publicada</small></div><div class="arrow">round robin →</div>
<div class="group"><div class="caption">rede do Compose · sem <code>ports:</code></div><div class="box">catalog-1<small>1 CPU</small></div><div class="box">catalog-2<small>1 CPU</small></div><div class="box">catalog-3<small>1 CPU</small></div></div><div class="arrow">→</div>
<div class="box green" style="flex: .7">db<small>PostgreSQL, compartilhado</small></div>
</div>

- As réplicas são privadas, como instâncias numa sub-rede privada de uma VPC na nuvem (aula 12).
- Cabeçalho `X-Instance`: qual réplica respondeu. A única mudança de código do lab.

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
- `resolve`: resolve os nomes de novo pelo Sistema de Nomes de Domínio (DNS, *Domain Name System*) do Docker a cada 10 s — sobe mesmo com uma réplica fora do ar e a retoma quando ela volta.

---

## Timeouts e retries

<div class="flow">
<div class="box">GET</div><div class="arrow">→</div>
<div class="box red">catalog-3 congelado<small>connect 1 s · read 5 s numa conexão reaproveitada</small></div><div class="arrow">timeout →</div>
<div class="box accent">next upstream<small>segunda e última tentativa</small></div><div class="arrow">→</div>
<div class="box green">catalog-1: 200<small>cerca de 1 s atrasado, sem erro</small></div>
</div>

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
| `stop` | recusada → retry na hora; depois o nome some do DNS | ✅ ~nada |
| `pause` | sem resposta: 1 s (conexão nova) ou 5 s (reaproveitada) → retry | ⚠️ nenhum erro, latência no percentil 99 (p99) de ~1–5 s |
| 3 falhas em 10 s | fora do rodízio por 10 s, depois uma requisição de teste | normal de novo |

<div class="warn">

Uma réplica **morta** é fácil. Uma **lenta** é perigosa: o timeout decide quanto ela custa.

</div>

---

## Health checks passivos vs ativos

- **Passivos** (Nginx open source): aprendem com requisições reais que falharam.
- **Ativos** (Envoy, HAProxy, load balancers da nuvem, readiness do Kubernetes): sondam `/actuator/health/readiness`.
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

<div class="flow">
<div class="box">requisição</div><div class="arrow">→</div>
<div class="box muted">sem <code>X-Api-Key</code>?<small>chave vazia: sem limite</small></div><div class="arrow">senão →</div>
<div class="box accent">excesso dentro de burst=40?<small>escoa a 20/s</small></div><div class="arrow">→</div>
<div class="box green">proxy</div><div class="box red">429</div>
</div>

---

## Quem é o cliente?

- Um cabeçalho escolhido pelo cliente pode ser **trocado** por um atacante.
- Limites reais: identidades verificadas (chaves de API emitidas, o `sub` de um JSON Web Token, JWT — lab 4) **mais** limite por IP para tráfego anônimo.
- Limite por IP erra atrás de tradução de endereços (NAT, *network address translation*) — e estrangula o nosso k6 de um único IP.

---

## Sem Docker: o gêmeo

<div class="flow">
<div class="box accent">4 · distribuição<small>9 curls: 3 por réplica · log de acesso com rt e ut</small></div>
<div class="box red">5 · parar e congelar<small>stop: nenhuma requisição lenta · pause: 58 esperam 1 ou 5 s · 0 erros, máximo de 5,02 s</small></div>
<div class="box orange">6 · rate limit<small>greedy 640 × 200, 860 × 429 · polite 300 × 200</small></div>
</div>

- O `nginx.conf` do lab, requisição por requisição: round robin, `max_fails`, os dois timeouts, a repetição, `limit_req`.
- O p99 do gêmeo fica em 29 ms: 58 requisições lentas em 18.000 são menos de 1%. A execução da página pegou mais e o p99 dela chegou a 1 s.
- Depois do `fail_timeout`, o Nginx deixa passar **uma** requisição de teste a cada 10 s.

<!--
O simulador está no passo 5 da página do lab; cada roteiro repete um passo da página.
-->

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
