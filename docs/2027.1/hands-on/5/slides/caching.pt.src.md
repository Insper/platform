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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Arquitetura de Sistemas · Insper · Lab 5</div>

# Lab 5 — Caching

**Cache-aside com Redis no `catalog`: hit ratio, p99, invalidação — e um stampede, reproduzido e corrigido**

<!--
Roteiro: (1) por que fazer cache do catálogo; (2) o que você vai construir; (3) cache-aside e EventCache;
(4) chaves e tempo de vida; (5) invalidação; (6) tratamento de falhas; (7) a conta do hit ratio e a
medição; (8) stampede e o lock; (9) outras curas; (10) o simulador.
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

## O que você vai construir

<div class="flow">
<div class="box muted" style="flex: .5">fã</div><div class="arrow">→</div>
<div class="box">edge → gateway<small>rodízio</small></div><div class="arrow">→</div>
<div class="box accent">catalog-1..3<small>EventCache · header X-Cache</small></div><div class="arrow">→</div>
<div class="group">
<div class="caption">compartilhados pelas três réplicas</div>
<div class="box green">redis :6379<small>256 MB, allkeys-lru, sem persistência</small></div>
<div class="box orange">db<small>PostgreSQL: só num miss</small></div>
</div>
</div>

- Primeiro `GET /catalog/events/42`: `X-Cache: MISS` — o banco responde, a notação de objetos JavaScript (JSON, *JavaScript Object Notation*) vai para o Redis.
- O segundo, mesmo em outra réplica: `X-Cache: HIT` — nenhum acesso ao banco.

---

## Cache-aside no `EventCache`

<div class="flow">
<div class="box">GET key</div><div class="arrow">hit →</div>
<div class="box green">devolve o JSON<small>X-Cache: HIT</small></div>
</div>
<div class="flow">
<div class="box">GET key</div><div class="arrow">nil →</div>
<div class="box orange">SELECT … no PostgreSQL</div><div class="arrow">→</div>
<div class="box accent">SET key json PX ttl + 0–10%</div><div class="arrow">→</div>
<div class="box">devolve<small>X-Cache: MISS</small></div>
</div>

| Padrão | Quem carrega | Escritas |
|---|---|---|
| **cache-aside** ✅ | a aplicação, no miss | banco, depois remove |
| read-through | o cache | — |
| write-through | — | cache + banco, síncrono |
| write-behind | — | cache agora, banco depois ⚠️ |

---

## Chaves e tempo de vida (TTL, *time to live*)

| Chave | TTL | Invalidação |
|---|---|---|
| `catalog:event:{id}` | 60 s | removida em update/delete |
| `catalog:events:city=…:page=…` | 10 s | só expira |

- Guarde o **JSON da resposta**: um hit não custa banco nem serialização.
- Ponha **jitter** no TTL (+0–10%): chaves escritas juntas não expiram juntas.

---

## Invalidação

<div class="flow">
<div class="box">PUT /catalog/events/42<small>token de admin</small></div><div class="arrow">→</div>
<div class="box accent">UPDATE + COMMIT</div><div class="arrow">→</div>
<div class="box green">DEL catalog:event:42<small>próxima leitura: MISS, dado novo</small></div>
<div class="box orange">chaves de listagem intactas<small>desatualizadas por até 10 s</small></div>
</div>

- **Remova**, não sobrescreva: atualizações concorrentes poderiam deixar em cache uma versão mais antiga.
- Toda chave mantém um **TTL**: a rede de segurança para toda corrida.

<div class="q">

Um admin muda um preço. Por quanto tempo um fã pode ver o antigo, em cada página?

</div>

---

## Quando o Redis falha

<div class="flow">
<div class="box">GET key</div><div class="arrow">→</div>
<div class="box red">Redis fora ou lento<small>timeout de 200 ms</small></div><div class="arrow">→</div>
<div class="box orange">registra, trata como miss</div><div class="arrow">→</div>
<div class="box green">200 do PostgreSQL<small>X-Cache: MISS</small></div>
</div>

- O timeout padrão do Lettuce é **60 s** → defina **200 ms**.
- Todo erro do Redis vira um **miss**: mais lento, mas funcionando.
- Sem persistência: depois de um reinício o cache está **frio**.

<div class="warn">

Se o cache absorvia 95% das leituras, a queda dele manda **20×** a carga para o banco.

</div>

---

## A conta do hit ratio

* Leituras no banco = (1 − h) × total de leituras.
* h = 90% → o banco vê 10%. h = 99% → o banco vê **1%**.
* O hit ratio depende do **espaço de chaves, da concentração e do TTL** — não da velocidade do Redis.

---

## Meça

```bash
CACHE_ENABLED=false docker compose up -d --wait && k6 run -e RATE=300 load/cache.js
CACHE_ENABLED=true  docker compose up -d --wait && docker compose exec redis redis-cli FLUSHALL
k6 run -e RATE=300 load/cache.js     # cold
k6 run -e RATE=300 load/cache.js     # warm
```

- 80% das requisições de detalhe vão para os 2.000 eventos mais quentes (1% do catálogo).
- O k6 lê o `X-Cache`: taxa `cache_hit`, `latency_hit`, `latency_miss`.
- Numa execução deste lab: ~72% frio, 72% de novo quente com o TTL de 60 s; com `CACHE_TTL_EVENT=5m`, 83% quente contra 71% frio.

<!--
Com 60 s, as chaves gravadas no começo da execução fria expiram no começo da seguinte: cada chave quente
dá miss cerca de uma vez por minuto nas duas. Um TTL mais longo que a execução mostra o cache quente
vencer. Aquecimentos antes de cada execução: as réplicas recriadas são JVMs frias.
-->

---

## O stampede

- Uma **chave quente** expira.
- Toda requisição que chega durante a recarga dá **miss**.
- 200 consultas pesadas idênticas atingem o banco ao mesmo tempo.

```bash
CACHE_TTL_LIST=3s CACHE_STAMPEDE_PROTECTION=false docker compose up -d --wait
k6 run load/stampede.js       # cache_misses ≫ expirations
```

---

## Correção: uma reconstrução por chave

<div class="flow">
<div class="box">miss</div><div class="arrow">→</div>
<div class="box accent">SET key:lock token NX PX 2000</div><div class="arrow">ganhou →</div>
<div class="box green">confere de novo, carrega, SET, libera<small>uma consulta por expiração</small></div>
</div>
<div class="flow">
<div class="box muted" style="flex: .45">todas as outras</div><div class="arrow">perdeu →</div>
<div class="box orange">consulta o cache a cada 25 ms<small>≤ 500 ms, depois carrega mesmo assim</small></div><div class="arrow">→</div>
<div class="box green">HIT</div>
</div>

- Numa execução de teste (200 usuários virtuais, 60 s): misses **2.238 → 19**; p99 ~1 s → ~0,3 s; unidade central de processamento (CPU, *central processing unit*) do `db` 234% → 4%.
- O lock expira se o dono morrer; libere só o **seu** token (de forma atômica: um script Lua).

---

## Outras curas

| Técnica | Trade-off |
|---|---|
| jitter no TTL | não ajuda com uma chave quente |
| atualização antecipada probabilística | algum trabalho duplicado |
| stale-while-revalidate | clientes veem dados velhos por pouco tempo |
| refresh-ahead | precisa conhecer as chaves quentes |
| agrupamento de requisições na borda | só respostas cacheáveis do protocolo de transferência de hipertexto (HTTP, *Hypertext Transfer Protocol*) |

---

## Sem Docker: o simulador

<div class="flow">
<div class="box accent">Confira (passo 5)<small>MISS em catalog-2, HIT em catalog-3, TTL 62</small></div>
<div class="box orange">Listagem após uma atualização<small>um HIT desatualizado por 7 s, ≤ CACHE_TTL_LIST</small></div>
<div class="box green">TTL e BYPASS<small>um miss por expiração, cada BYPASS uma consulta</small></div>
</div>

- A página Cache-aside embute o cache do lab 5 como simulador: mesmas chaves, TTLs e saídas.
- Pare o Redis: ainda um 200; inicie-o: vazio, porque não há persistência.

<!--
O simulador fica no fim do passo 5 de Cache-aside.
-->

---

## Pontos-chave

1. Cache-aside: a aplicação carrega no miss, **remove** na escrita, toda chave tem um **TTL**.
2. Um cache só é tão bom quanto o seu **hit ratio** — que se alimenta de concentração.
3. O cache é uma otimização: **falhe aberto** para o banco, com timeouts curtos.
4. Chaves quentes expirando causam **stampedes**: junte misses concorrentes em uma só carga.
5. Declare a defasagem que você aceita — é uma decisão de produto.
