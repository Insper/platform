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

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

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
Por que o banco do catálogo chega a 100% da unidade central de processamento (CPU, *central processing unit*) — e derruba o checkout junto?

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
- **Diferença de latência**: memória de acesso aleatório (RAM, *random-access memory*) ~100 ns · Redis no mesmo data center ~0,5 ms · uma consulta em linguagem de consulta estruturada (SQL, *Structured Query Language*) 1–100 ms.

<div class="ok">

Um cache deixa as leituras mais rápidas, mas seu trabalho real é **tirar trabalho** da fonte da verdade.

</div>

---

## Onde os caches ficam

<div class="flow">
<div class="box">navegador / app<small>Cache-Control, ETag · não dá para recolher</small></div><div class="arrow">falta →</div>
<div class="box">rede de distribuição de conteúdo (CDN, <em>content delivery network</em>)<small>páginas públicas · purge, endereços versionados</small></div><div class="arrow">→</div>
<div class="box">gateway<small>respostas GET inteiras, alguns segundos</small></div><div class="arrow">→</div>
<div class="box accent">em processo<small>Caffeine · cada réplica por si</small></div><div class="arrow">→</div>
<div class="box green">Redis<small>compartilhado · remoção na escrita + tempo de vida (TTL, <em>time to live</em>)</small></div><div class="arrow">→</div>
<div class="box orange">banco de dados<small>buffer pool · sempre consistente</small></div>
</div>

- Mais perto do usuário: mais rápido e mais barato por acerto, porém **mais difícil de invalidar**.
- BoxOffice: notação de objetos JavaScript (JSON, *JavaScript Object Notation*) do evento com `max-age=10` no navegador, `GET /events/42` por 5 s no gateway, geometria do local no Caffeine, detalhes do evento no Redis.
- Esta aula: o lado da aplicação, caches em processo e distribuídos; as CDNs ficam em Tráfego e Borda.

---

## A matemática da taxa de acerto

$$t_{\text{eff}} = h \cdot t_{\text{hit}} + (1-h) \cdot t_{\text{miss}} \qquad \text{QPS}_{\text{DB}} = (1-h) \cdot \text{QPS}$$

| Taxa de acerto | Latência efetiva (0,5 / 8,5 ms) | Carga no banco (consultas por segundo, QPS, *queries per second*) com 50.000 leituras/s |
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

<div class="flow">
<div class="arrow" style="flex: .35; text-align: left">Leitura</div>
<div class="box">GET key</div><div class="arrow">acerto →</div><div class="box green">devolve</div>
<div class="arrow">falta →</div><div class="box orange">lê o banco</div><div class="arrow">→</div>
<div class="box accent">SET key EX ttl</div><div class="arrow">→</div><div class="box">devolve</div>
</div>
<div class="flow">
<div class="arrow" style="flex: .35; text-align: left">Escrita</div>
<div class="box">atualiza o banco</div><div class="arrow">→</div><div class="box accent">commit</div><div class="arrow">→</div>
<div class="box green">DEL key<small>a próxima leitura a preenche</small></div>
</div>

- Só o que é lido vai para o cache; cache fora → a app lê o banco (se ele aguentar).

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
| Write-through | escreve cache + banco de dados (DB, *database*) juntos | leituras frescas após escritas | duas escritas, não atômicas | painel do organizador |
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
- Valores pequenos (comprima acima de alguns KB); cacheie **objetos de transferência de dados (DTOs, *data transfer objects*)**, não entidades da Java Persistence API (JPA).
- **Cache negativo**: guarde "não encontrado" por 30–60 s.
- **Nível 1 + nível 2 (L1 + L2, *level 1 + level 2*)**: Caffeine em cada réplica (µs) na frente do Redis (~0,5 ms) — absorve chaves quentes, mas agora são **20 cópias** para invalidar.

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

<div class="flow">
<div class="box">leitor: falta<small>o SELECT lê v1</small></div><div class="arrow">pausa →</div>
<div class="box accent">escritor: v2 + COMMIT<small>depois DEL key</small></div><div class="arrow">→</div>
<div class="box orange">leitor: SET key v1<small>depois da remoção</small></div><div class="arrow">→</div>
<div class="box red">v1 velho<small>até o TTL</small></div>
</div>

- **Atualizar na escrita**: dois escritores chegam ao banco e ao cache em ordens diferentes → fica o valor mais antigo. **Remover** é idempotente.
- Primeiro escreve, depois remove — **depois do commit**; remover antes deixa um leitor recolocar a linha antiga.
- Correções para a corrida acima: **TTL** (sempre) · remoção dupla atrasada · **set-if-newer versionado** (Lua) · **leases**.

<!--
A página desenha as duas corridas passo a passo: as atualizações reordenadas e o leitor lento.
-->

---

## Muitos escritores, muitas cópias — e o que um cache pode prometer

- Jobs, scripts, outros serviços? **Captura de mudanças (CDC, *change data capture*)**: o Debezium lê o log de escrita antecipada (WAL, *write-ahead log*) → Kafka → invalidador `DEL` + pub/sub para cada L1.
- Cópias que você não consegue apagar (assets na CDN, navegadores): **versione o localizador uniforme de recurso (URL, *uniform resource locator*)**.

| Garantia | Com um cache |
|---|---|
| Defasagem limitada | ✅ TTL ≤ T |
| Read-your-writes | ⚠️ write-through para aquela chave, ou desviar do cache por um instante |
| Leituras monotônicas | ⚠️ não misture caches de atualidades diferentes para um usuário |
| Linearizabilidade | ❌ não com cache: leia a fonte da verdade (o checkout lê o preço) |

---

## Políticas de despejo

| Política | Mantém | Fraqueza |
|---|---|---|
| menos usado recentemente (LRU, *least recently used*) | os usados recentemente | uma **varredura** expulsa o conjunto quente |
| menos usado com frequência (LFU, *least frequently used*) | os usados com frequência | demora a esquecer (precisa envelhecer) |
| primeiro a entrar, primeiro a sair (FIFO, *first in, first out*) / aleatória | — | ignoram a popularidade |
| W-TinyLFU (Caffeine) | admitidos por frequência + pequena janela LRU | mais complexa |

- Redis: `allkeys-lru` / `allkeys-lfu` para caches; `noeviction` para sessões e locks.
- O LRU/LFU do Redis é **aproximado** por amostragem (`maxmemory-samples 5`).

---

## Modos de falha num relance

| Falha | Sintoma | Correção |
|---|---|---|
| Cache frio | o banco recebe tudo após reinício/deploy | aquecimento, deslocamento gradual |
| ***Stampede*** | chave quente expira, N consultas idênticas | agrupamento, lock, stale-while-revalidate, XFetch |
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
- Persistência: nenhuma · snapshots do Redis Database (RDB) · arquivo só de acréscimo (AOF, *append-only file*, `everysec`) · ambos.
- Replicação **assíncrona**; o Sentinel promove uma réplica em segundos.
- 2024: troca de licença → fork **Valkey** (Linux Foundation); 2025: o Redis 8 acrescenta a AGPLv3.

---

## Redis Cluster

<div class="flow">
<div class="box">cliente cluster-aware<small>mapa de slots em cache</small></div><div class="arrow">CRC16(key) mod 16384 →</div>
<div class="group">
<div class="caption">3 primários, cada um com uma réplica</div>
<div class="box">primário A<small>slots 0–5460</small></div>
<div class="box">primário B<small>5461–10922 · prices:42 → 9049</small></div>
<div class="box accent">primário C<small>10923–16383 · event:42 → 16271</small></div>
</div>
</div>

- **16.384 hash slots** (uma verificação de redundância cíclica, CRC16, *cyclic redundancy check*, escolhe o slot); `MOVED` / `ASK` redirecionam quando o mapa muda.
- Acrescentar um nó = mover slots, no ar. Operações multichave só dentro de um slot → **hash tags**: `{event:42}:seats`.

<div class="warn">

`{boxoffice}:*` coloca a aplicação inteira num nó — use como tag algo com **muitos** valores.

</div>

---

## Pré-reserva de assento: o Redis filtra, o SQL decide

<div class="flow">
<div class="box">fã 1017<small>SET hold:42:A-12 … NX PX 600000</small></div><div class="arrow">OK →</div>
<div class="box accent">inventory</div><div class="arrow">→</div>
<div class="box green">transação PostgreSQL<small>única por assento: ela decide</small></div>
</div>
<div class="flow">
<div class="box">fã 2203<small>o mesmo SET</small></div><div class="arrow">nil →</div>
<div class="box red">"lugar ocupado"<small>microssegundos, sem trabalho no banco</small></div>
</div>

- Rejeita a maioria dos cliques concorrentes em microssegundos, antes do banco.
- Mas replicação assíncrona, despejo ou um flush podem **perder** uma reserva concedida.
- O vencedor ainda faz a reserva numa **transação PostgreSQL** com uma restrição.

<div class="ok">

Se o Redis perder uma pré-reserva, dois fãs chegam ao banco e um perde lá. A correção nunca dependeu do Redis.

</div>

---

## Experimente: os dois simuladores

<div class="flow">
<div class="box accent">cache (Padrões)<small>TTL de 60 s, o do lab 5: ~86% de acertos, ~29 das 200 leituras/s chegam ao banco, nenhuma leitura desatualizada · só TTL: ~11% desatualizadas</small></div>
<div class="box orange">stampede (Modos de falha)<small>sem proteção: ~1.060 consultas/s em t = 3 s, p99 ~5 s · agrupamento: 122 consultas · + jitter: pico de 120/s · as três: 90/s</small></div>
</div>

- Cada controle é uma decisão desta aula: estratégia de invalidação, TTL, tamanho do cache; agrupamento, jitter, XFetch.
- Os dois tiram os padrões do lab 5 (`CACHE_TTL_EVENT`, o teste de stampede de 3 s, 10% de jitter).

<!--
O simulador de cache fica depois da comparação dos padrões; o de stampede, depois da tabela de correções.
-->

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
