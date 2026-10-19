---
marp: true
lang: pt-BR
title: Cache
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

# Cache

**Pare de fazer ao banco a mesma pergunta dois milhões de vezes**

<!--
Roteiro: (1) por que caches funcionam e onde ficam; (2) a matemática da taxa de acerto e o
dimensionamento; (3) padrões; (4) invalidação e despejo; (5) modos de falha; (6) Redis.
-->

---

## 10h00, o show de estádio abre as vendas

<div class="q">

2 M fãs apertam F5 na mesma página de evento. Os dados não mudam há uma semana.
Por que o banco do catálogo chega a 100% de CPU — e derruba o checkout junto?

</div>

- Todo `GET /events/42` executa as **mesmas** três consultas: evento, local, preços.
- Dezenas de milhares de perguntas idênticas por segundo; a consulta vai de 3 ms para 800 ms.
- O checkout compartilha o banco: **ninguém comprou nada e o sistema caiu**.
- A solução não é um banco maior. É **guardar a resposta** e servir a cópia.

<!--
Deixe a turma responder primeiro. Leve-os a: o trabalho é redundante, então elimine-o.
-->

---

## Por que caches funcionam

- **Localidade temporal** — o que foi lido há pouco será lido de novo (F5).
- **Concentração** — a popularidade é aproximadamente **Zipf**: a posição $i$ recebe $\propto 1/i^s$ das requisições.
- Com $s \approx 1$, o **1%** mais popular de 100.000 eventos leva **~60%** das leituras.
- **Diferença de latência**: RAM ~100 ns · Redis no DC ~0,5 ms · SQL 1–100 ms.

<div class="ok">

Um cache deixa as leituras mais rápidas, mas seu trabalho real é **tirar trabalho** da fonte da verdade.

</div>

---

<!-- _class: tight -->

## Onde os caches ficam

| Camada | Guarda | Invalidado por | BoxOffice |
|---|---|---|---|
| Cliente (navegador, app) | respostas HTTP (`Cache-Control`, `ETag`) | só cabeçalhos — não dá para recolher | JS versionado, JSON do evento `max-age=10` |
| CDN | estáticos, páginas públicas | API de purge, URLs versionadas | pôsteres, página pública do evento |
| API gateway | respostas `GET` inteiras | TTL curto | `GET /events/42` por 5 s |
| Em processo (Caffeine) | objetos quentes no heap | cada réplica separadamente | geometria do local |
| Distribuído (Redis, Valkey) | objetos, resultados, sessões | app (remoção) + TTL | detalhes do evento, busca |
| Banco de dados | páginas no buffer pool | o motor — sempre consistente | páginas do índice de `seats` |

<p class="small">Mais perto do usuário: mais rápido e mais barato por acerto, porém mais difícil de invalidar.</p>

---

## A matemática da taxa de acerto

$$t_{\text{eff}} = h \cdot t_{\text{hit}} + (1-h) \cdot t_{\text{miss}} \qquad \text{QPS}_{\text{DB}} = (1-h) \cdot \text{QPS}$$

| Taxa de acerto | Latência efetiva (0,5 / 8,5 ms) | Carga no banco com 50.000 leituras/s |
|---|---|---|
| 90% | 1,3 ms | 5.000 QPS |
| 99% | 0,58 ms | 500 QPS |
| 99,9% | 0,51 ms | 50 QPS |

<div class="ok">

Pense na **taxa de falta**: cada nove a mais é **10× menos** carga no banco.

</div>

---

## Dimensionamento e o que não cachear

- Dimensione para o **conjunto de trabalho**, não para os dados: 20.000 eventos × 4 KB ≈ 82 MB.
- Meça o tamanho dos itens (`MEMORY USAGE`); acompanhe **despejos** vs taxa de acerto; deixe folga.
- Um TTL $T$ numa chave lida $r$/s dá no máximo $1 - 1/(rT+1)$: TTLs curtos prejudicam a **cauda longa**.

<div class="warn">

**Cacheie o que você exibe, não aquilo sobre o que você decide.** O mapa de assentos pode ter 1 s de defasagem; a **reserva do assento** é decidida numa transação SQL. O mesmo vale para preços no checkout, pagamentos, saldos.

</div>

---

## Cache-aside: o padrão default

<div class="cols">
<div>

**Leitura**: `GET` → acertou? devolve. Falta → lê o banco → `SET key EX ttl` → devolve.

**Escrita**: atualiza o banco → **commit** → `DEL key`.

</div>
<div>

- Só o que é lido vai para o cache.
- Cache fora → a app lê o banco (se ele aguentar).
- Custos: primeira leitura lenta; defasagem limitada pelo TTL.

</div>
</div>

```java
@Cacheable(cacheNames = "events", key = "#id")
public EventDto findById(long id) { ... }

@CacheEvict(cacheNames = "events", key = "#id")   // after commit!
public EventDto update(long id, EventUpdate change) { ... }
```

---

<!-- _class: tight -->

## Os outros padrões

| Padrão | Ideia | Bom | Risco | BoxOffice |
|---|---|---|---|---|
| Read-through | o cache carrega na falta | agrupa faltas concorrentes | — | geometria do local (Caffeine) |
| Write-through | escreve cache + banco juntos | leituras frescas após escritas | duas escritas, não atômicas | painel do organizador |
| Write-behind | cache agora, banco depois | escritas na velocidade da memória | **perde escritas confirmadas** | contadores de visualização |
| Write-around | escreve no banco, pula o cache | sem poluição | primeira leitura erra | ingressos, histórico de pedidos |
| Refresh-ahead | recarrega antes de expirar | chaves quentes nunca erram | atualizações desperdiçadas | aberturas de venda de hoje |

<div class="warn">

Write-behind para reservas de assento = venda dupla depois de uma falha do cache.

</div>

---

## Chaves, valores e dois níveis

- Chaves com namespace e versão: `boxoffice:catalog:event:42:v3`.
- Coloque na chave **tudo que muda a resposta**: idioma, moeda, página, usuário.
- Valores pequenos (comprima acima de alguns KB); cacheie **DTOs**, não entidades JPA.
- **Cache negativo**: guarde "não encontrado" por 30–60 s.
- **L1 + L2**: Caffeine em cada réplica (µs) na frente do Redis (~0,5 ms) — absorve chaves quentes, mas agora são **20 cópias** para invalidar.

---

## Invalidação: o orçamento de defasagem

| Dado | Defasagem aceitável | Mecanismo |
|---|---|---|
| Descrição do evento | ~1 min | remoção na escrita + TTL 5 min |
| Tabela de preços | segundos | TTL 30 s + remoção; **o checkout lê o banco** |
| Mapa de assentos (exibição) | 1–2 s | TTL 1 s |
| Perfil do usuário | read-your-writes para o dono | remoção + desvio do cache para quem escreveu |
| Reserva, pedido, pagamento | **zero** | não cacheado |

<div class="ok">

Decida o orçamento por tipo de dado **com o time de produto**; o mecanismo decorre dele.

</div>

---

## Remova, não atualize — e cuidado com a corrida

- **Atualizar na escrita**: dois escritores chegam ao banco e ao cache em ordens diferentes → o cache fica com o valor mais antigo.
- **Remover** é idempotente e independe da ordem.
- Ainda sobra uma corrida: leitor lento lê `v1` → escritor confirma `v2` + `DEL` → leitor faz `SET v1`.
- Correções: **TTL** (sempre) · remoção dupla atrasada · **set-if-newer versionado** (Lua) · **leases** (memcache do Facebook).
- Muitos escritores (jobs, scripts)? **CDC**: Debezium lê o WAL → Kafka → invalidador `DEL` + pub/sub para o L1.

<!--
Desenhe a corrida no quadro como uma linha do tempo de quatro passos.
-->

---

## Políticas de despejo

| Política | Mantém | Fraqueza |
|---|---|---|
| LRU | os usados recentemente | uma **varredura** expulsa o conjunto quente |
| LFU | os usados com frequência | demora a esquecer (precisa envelhecer) |
| FIFO / aleatória | — | ignoram a popularidade |
| W-TinyLFU (Caffeine) | admitidos por frequência + pequena janela LRU | mais complexa |

- Redis: `allkeys-lru` / `allkeys-lfu` para caches; `noeviction` para sessões e locks.
- O LRU/LFU do Redis é **aproximado** por amostragem (`maxmemory-samples 5`).

---

## Modos de falha num relance

| Falha | Sintoma | Correção |
|---|---|---|
| Cache frio | o banco recebe tudo após reinício/deploy | aquecimento, deslocamento gradual |
| ***Stampede*** | chave quente expira, N consultas idênticas | agrupamento, lock, SWR, XFetch |
| Avalanche | muitas chaves expiram juntas | **jitter no TTL** |
| Penetração | ids que não existem | cache negativo, filtro de Bloom |
| Chave quente | um nó satura | cache L1, replicação da chave |
| Cache fora | o banco dimensionado para as faltas recebe 100% | timeouts, breaker, descarte de carga |

---

## *Stampede*: os números

<div class="q">

`event:42`: **20.000 leituras/s**; recalcular leva **200 ms**. A chave expira. Quantas consultas idênticas chegam ao banco?

</div>

- Lei de Little: 20.000 × 0,2 s ≈ **4.000** — e a consulta fica mais lenta sob carga.
- **Agrupamento** (single-flight): uma consulta por réplica → 20.
- **Lock**: `SET lock:key token NX PX 5000`; as perdedoras esperam e releem.
- **Stale-while-revalidate**: TTL suave dentro do valor; serve o velho enquanto um atualiza.

---

## XFetch: expiração antecipada probabilística

Recalcule se $\;t_{\text{now}} - \delta \beta \ln(u) \geq t_{\text{expiry}}$, com $u \sim U(0,1]$, $\delta$ = tempo de recálculo.

- Cada leitura "olha à frente" por um tempo exponencial de média $\delta\beta$.
- P(a chave expirar sem ninguém atualizar antes) $= e^{-\lambda \delta \beta}$ para $\lambda$ leituras/s.
- Chave quente (1.000 leituras/s, δ = 0,2 s): atualizada antes por **um** leitor, quase com certeza.
- Chave fria: simplesmente expira — nela não há *stampede* possível.

<div class="ok">

Sem locks, sem coordenação: o algoritmo se adapta ao tráfego.

</div>

---

## Chaves quentes e a queda do cache

<div class="cols">
<div>

**Chave quente**: 400.000 leituras/s × 4 KB ≈ **13 Gbit/s** num nó só.

- Acrescentar nós não ajuda.
- Cache L1 com TTL de 1 s em 50 réplicas → ~50 leituras/s.
- Réplicas da chave `event:42#0..7`, CDN para a parte estática.

</div>
<div>

**Cache fora**: o banco foi dimensionado para as faltas.

- Timeouts (~50 ms) + circuit breaker.
- Limitar consultas de fallback; servir degradado / sala de espera.
- Réplicas + failover automático; gutter pool.

</div>
</div>

<div class="warn">

Quando o banco depende da taxa de acerto, o cache é uma **dependência que sustenta carga**.

</div>

---

## O Redis num slide

- Servidor em memória de **estruturas de dados**; uma thread executa os comandos → cada comando é **atômico**.
- Strings · hashes (sessões) · sorted sets (**sala de espera**) · HyperLogLog (visitantes únicos) · streams.
- Atomicidade em vários passos: `MULTI/EXEC` (sem rollback), **scripts Lua / functions**.
- Persistência: nenhuma · snapshots RDB · AOF (`everysec`) · ambos.
- Replicação **assíncrona**; o Sentinel promove uma réplica em segundos.
- 2024: troca de licença → fork **Valkey** (Linux Foundation); 2025: o Redis 8 acrescenta a AGPLv3.

---

## Redis Cluster

- **16.384 hash slots**; `slot = CRC16(key) mod 16384`; cada primário é dono de uma faixa.
- Clientes cluster-aware guardam o mapa; `MOVED` / `ASK` redirecionam quando ele muda.
- Acrescentar um nó = mover slots, com o sistema no ar.
- Operações multichave só dentro de um slot → **hash tags**: `{event:42}:seats`, `{event:42}:prices`.

<div class="warn">

`{boxoffice}:*` coloca a aplicação inteira num nó — use como tag algo com **muitos** valores.

</div>

---

## Pré-reserva de assento: o Redis filtra, o SQL decide

```text
> SET hold:42:A-12 fan:1017 NX PX 600000
OK
> SET hold:42:A-12 fan:2203 NX PX 600000
(nil)
```

- Rejeita a maioria dos cliques concorrentes em microssegundos, antes do banco.
- Mas replicação assíncrona, despejo ou um flush podem **perder** uma reserva concedida.
- O vencedor ainda faz a reserva numa **transação PostgreSQL** com uma restrição.

<div class="ok">

Se o Redis perder uma pré-reserva, dois fãs chegam ao banco e um perde lá. A correção nunca dependeu do Redis.

</div>

---

<!-- _class: tight -->

## O mapa de conceitos de caching

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `client` `mobile` | o dispositivo pode pular a requisição? | `Cache-Control`, `ETag`, assets versionados |
| `cdn` `apigw` | a borda pode responder pela origem? | páginas públicas, TTLs curtos, purge por tag |
| `app` | cada réplica pode manter os objetos mais quentes? | L1 em processo, cache em dois níveis |
| `cache` | uma cópia compartilhada absorve a maioria das leituras? | cache-aside, TTL, despejo, taxa de acerto, dimensionamento |
| `cache` (sob estresse) | chave quente expira? o cache cai? | stampede, avalanche, chaves quentes, fallback |
| `sql` | o que o cache protege? | fonte da verdade — cacheie o que exibe, não aquilo com que decide |
| `stream` `pubsub` | como uma mudança chega a todas as cópias? | CDC a partir do WAL, broadcast para o L1 |

<p class="small">Cada camada é mais rápida e mais perto do usuário, mas guarda menos e é <b>mais difícil de invalidar</b>.</p>

---

## Pontos-chave

1. Caches funcionam por **localidade e concentração**; seu trabalho principal é proteger a fonte da verdade.
2. $\text{QPS}_{\text{DB}} = (1-h) \cdot \text{QPS}$: pense na **taxa de falta**; cada nove é 10× menos carga.
3. **Cache-aside + remoção depois do commit + TTL** é a base; write-behind só para dados que podem ser perdidos.
4. Defina um **orçamento de defasagem** por tipo de dado; o TTL é sempre a rede de segurança; CDC para muitos escritores.
5. Prefira despejo sensível à frequência (LFU, W-TinyLFU) quando varreduras poluem o LRU.
6. Planeje para *stampede*, avalanche, penetração, chaves quentes e **a queda do cache**.
7. **Cacheie o que você exibe, não aquilo sobre o que você decide**: reservas e pagamentos vão ao banco.
