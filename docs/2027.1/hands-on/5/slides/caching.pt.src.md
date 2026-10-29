---
marp: true
lang: pt-BR
title: Lab 5 — Cache
description: Arquitetura de Sistemas · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 5</div>

# Lab 5 — Cache

**Cache-aside com Redis no `catalog`: hit ratio, p99, invalidação — e um stampede, reproduzido e corrigido**

<!--
Roteiro: (1) por que fazer cache do catálogo; (2) cache-aside; (3) chaves e TTLs; (4) tratamento de
falhas; (5) a conta do hit ratio; (6) medição; (7) stampede e o lock; (8) outras curas.
-->

---

## O candidato perfeito a cache

<div class="q">

Quantas vezes "próximos eventos em São Paulo, página 1" é lido para cada vez que muda?

</div>

- Milhares de leituras, poucas escritas por dia.
- Forte **concentração de popularidade**: poucos eventos recebem a maior parte das visitas.
- Lab 2: o pool do banco é o gargalo.

---

## Cache-aside

```text
GET key ──► hit?  ── yes ─► return (no DB)
              │
              no ─► SELECT … ─► SET key value PX ttl ─► return
```

| Padrão | Quem carrega | Escritas |
|---|---|---|
| **cache-aside** | a aplicação, no miss | banco, depois remove |
| read-through | o cache | — |
| write-through | — | cache + banco, síncrono |
| write-behind | — | cache agora, banco depois |

---

## Chaves e TTLs

| Chave | TTL | Invalidação |
|---|---|---|
| `catalog:event:{id}` | 60 s | removida em update/delete |
| `catalog:events:city=…:page=…` | 10 s | só expira |

- Guarde o **JSON da resposta**: um hit não custa banco nem serialização.
- Ponha **jitter** no TTL (+0–10%).

---

## Quando o Redis falha

- O timeout padrão do Lettuce é **60 s** → defina **200 ms**.
- Todo erro do Redis vira um **miss**: mais lento, mas funcionando.

<div class="warn">

Se o cache absorvia 95% das leituras, a queda dele manda **20×** a carga para o banco.

</div>

---

## Invalidação

- **Remova**, não sobrescreva: atualizações concorrentes poderiam deixar em cache uma versão mais antiga.
- Toda chave mantém um **TTL**: a rede de segurança para toda corrida.
- Listagens: sem remoção, **defasagem limitada** de ~10 s.

<div class="q">

Um admin muda um preço. Por quanto tempo um fã pode ver o antigo, em cada página?

</div>

---

## A conta do hit ratio

* Leituras no banco = (1 − h) × total de leituras.
* h = 90% → o banco vê 10%. h = 99% → o banco vê **1%**.
* O hit ratio depende do **espaço de chaves, da concentração e do TTL** — não da velocidade do Redis.

---

## Meça

```bash
CACHE_ENABLED=false docker compose up -d && k6 run -e RATE=300 load/cache.js
CACHE_ENABLED=true  docker compose up -d && docker compose exec redis redis-cli FLUSHALL
k6 run -e RATE=300 load/cache.js     # cold
k6 run -e RATE=300 load/cache.js     # warm
```

- O k6 lê o `X-Cache`: taxa `cache_hit`, `latency_hit`, `latency_miss`.

---

## O stampede

- Uma **chave quente** expira.
- Toda requisição que chega durante a recarga dá **miss**.
- 200 consultas pesadas idênticas atingem o banco ao mesmo tempo.

```bash
CACHE_TTL_LIST=3s CACHE_STAMPEDE_PROTECTION=false docker compose up -d
k6 run load/stampede.js       # cache_misses ≫ expirations
```

---

## Correção: uma reconstrução por chave

```text
miss ─► SET key:lock token NX PX 2000
          ├─ won  ─► re-check, load, SET, release
          └─ lost ─► poll the cache every 25 ms (≤ 500 ms)
```

- Uma consulta por expiração, em **todas** as réplicas.
- O lock expira se o dono morrer; libere só o **seu** token.

---

## Outras curas

| Técnica | Trade-off |
|---|---|
| jitter no TTL | não ajuda com uma chave quente |
| atualização antecipada probabilística | algum trabalho duplicado |
| stale-while-revalidate | clientes veem dados velhos por pouco tempo |
| refresh-ahead | precisa conhecer as chaves quentes |
| agrupamento de requisições na borda | só HTTP cacheável |

---

## Pontos-chave

1. Cache-aside: a aplicação carrega no miss, **remove** na escrita, toda chave tem um **TTL**.
2. Um cache só é tão bom quanto o seu **hit ratio** — que se alimenta de concentração.
3. O cache é uma otimização: **falhe aberto** para o banco, com timeouts curtos.
4. Chaves quentes expirando causam **stampedes**: junte misses concorrentes em uma só carga.
5. Declare a defasagem que você aceita — é uma decisão de produto.
