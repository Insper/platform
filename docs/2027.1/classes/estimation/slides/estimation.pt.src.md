---
marp: true
lang: pt-BR
title: Estimativas de Guardanapo
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

# Estimativas de Guardanapo

**Números, filas, percentis e noves — a matemática por trás de toda decisão de design**

<!--
Roteiro: (1) por que estimar e o método; (2) números que todo engenheiro deveria saber; (3) QPS,
armazenamento, banda; (4) Lei de Little, utilização e o joelho; (5) Amdahl e USL; (6) percentis e
amplificação da cauda; (7) matemática da disponibilidade.
-->

---

## Um PostgreSQL aguenta a abertura de vendas?

<div class="q">

*"Não, precisamos de um banco distribuído."* — *"Claro que aguenta, o Postgres é rápido."*
O que você precisa saber para encerrar isso em cinco minutos?

</div>

* Demanda: quantas tentativas de reserva **por segundo** às 10:00?
* Custo de uma reserva: por quanto tempo ela mantém o banco **ocupado**?
* Ponto de operação seguro: quão **cheio** o banco pode rodar antes de a latência explodir?
* Experiência: o que os fãs **azarados** veem, e com que frequência fica **fora do ar**?

---

## Por que estimar?

Decisões mudam em **ordens de grandeza** — você precisa saber de que lado de um limiar está.

| Se a estimativa diz… | …a decisão é |
|---|---|
| 40 GB de pedidos por ano | um primário basta — **não particione** |
| 1.200 leituras/s, 99% repetidas | **coloque em cache** |
| 100 mil tentativas de reserva/s para 60 mil lugares | **enfileire** os fãs numa sala de espera |
| 8 Gbit/s de imagens | sirva por uma **CDN** |
| uma dependência síncrona a 99,9% | o serviço não pode prometer mais — **tire-a do caminho** |

---

## O método

1. **Dê nome à decisão** — "precisamos particionar?", e não "quantos dados?".
2. **Declare as premissas** em voz alta — números redondos.
3. **Potências de dez** — mantenha um algarismo significativo.
4. **Confira a sanidade** contra um número que você conhece.
5. **Conclua** — a implicação para o design e a premissa mais sensível.

<div class="ok">

1 dia ≈ **10⁵ s** · 1 M/dia ≈ **12/s** · 1 ano ≈ **3 × 10⁷ s** · 2¹⁰ ≈ **10³** · 1 GB/s = **8 Gbit/s**

</div>

---

<!-- _class: tight -->

## Números de latência (anos 2020, ordens de grandeza)

| Operação | Latência |
|---|---|
| Referência ao cache L1 | ~1 ns |
| Referência à memória principal | ~100 ns |
| Leitura aleatória de 4 KB, SSD NVMe | ~20–100 µs |
| Ida e volta dentro de uma zona | ~0,1–0,5 ms |
| `GET` no Redis / consulta por chave primária, mesma zona | ~0,2–1 ms |
| Ida e volta entre zonas | ~1–2 ms |
| Seek de HDD | ~5–10 ms |
| Ida e volta São Paulo ↔ costa leste dos EUA | ~110–130 ms |

<p class="small">Luz na fibra: ~5 µs por km → ~1 ms de ida e volta a cada 100 km. Fontes: Dean (2009), Scott, Gregg.</p>

---

## O que a tabela ensina

- **RAM ≈ 1.000× mais rápida que SSD** em leituras aleatórias → caches.
- **Dentro de um data centre, a rede custa mais que o trabalho** → agrupe as idas e voltas (`MGET`, pipelining).
- **Entre regiões, a física vence** → nada de chamadas síncronas entre regiões no caminho crítico; atenda de perto.
- **Sequencial ganha de aleatório** → logs, Kafka, processamento em lote.

<div class="q">

Mapa de lugares com 60.000 lugares: 60.000 consultas ≈ **30 s**; uma consulta ≈ **20–40 ms**; um blob em cache ≈ **1–2 ms**. Os mesmos dados, quatro ordens de grandeza.

</div>

---

## Requisições por segundo

> QPS = usuários ativos diários × ações / 86.400 · pico = QPS × fator de pico

<div class="cols">
<div>

### Dia normal

- 2 M de fãs × 20 páginas = 4 × 10⁷/dia
- ≈ **400 leituras/s**, pico ×3 ≈ **1.200**
- escritas ≈ 5/s → leitura/escrita ≈ **100:1**

</div>
<div>

### Pico da abertura de vendas

- 2 M de fãs × 3 requisições em 60 s
- ≈ **100.000 req/s** na borda
- **~80×** o pico normal, por minutos

</div>
</div>

<div class="warn">

Dimensione para o **pico** — e estime os **picos repentinos separadamente**.

</div>

---

## Armazenamento e banda

> armazenamento = itens × tamanho × retenção × replicação (× overhead de índices) · banda = QPS × tamanho

| Dado da BoxOffice | Por ano | Onde |
|---|---|---|
| Pedidos: 100 mil/dia × 1 KB | ~37 GB | SQL — **não precisa particionar** |
| PDFs de ingressos: 200 mil/dia × 100 KB | ~7 TB | Object Store (ou gerar sob demanda) |
| Imagens no pico: 1.200 visualizações/s × 1 MB | — | ~**10 Gbit/s** → **CDN** |

<p class="small">Bits vs bytes: um link de 10 Gbit/s carrega 1,25 GB/s.</p>

---

## Lei de Little

> **L = λ × W** — em andamento = taxa de chegada × tempo no sistema

| Forma | Pergunta | BoxOffice |
|---|---|---|
| L = λW | quantas em andamento? | 1.000 reservas/s × 40 ms = **40** em andamento |
| W = L/λ | quanto tempo de espera? | 2 M na fila ÷ 1.000/s = **33 min** |
| λ = L/W | que throughput? | 8 conexões ÷ 5 ms = **1.600 reservas/s** |

<p class="small">Vale para qualquer sistema estável, qualquer distribuição, qualquer número de servidores.</p>

---

## A Lei de Little em ação

- **Falha em cascata**: 100 pagamentos/s × 0,3 s = **30** threads esperando. O provedor fica lento, 3 s → **300** threads → um pool de 200 threads se esgota e *todas* as rotas falham.
- **Detector de mentiras para testes de carga**: laço fechado, N = X × (R + Z). 100 VUs, R = 50 ms → no máximo **2.000 req/s**; se R sobe para 500 ms → **200 req/s**. O teste recua exatamente quando o sistema sofre.

<div class="ok">

Pools: dimensione com L = λW **mais folga** — um pool de 500 conexões de banco não acrescenta capacidade, só contenção.

</div>

---

## Utilização e capacidade

> **U = X × S** · capacidade **X_max = c / S** (c servidores paralelos, S tempo de serviço)

- 1.000 reservas/s × 5 ms = 5 núcleos ocupados → **62,5%** de 8.
- O recurso com a maior utilização é o **gargalo**: ele limita o sistema inteiro.

<div class="q">

Por que não rodar a 95%?

</div>

---

## O joelho: R = S / (1 − ρ)

| Utilização ρ | R médio | p99 (M/M/1 ≈ 4,6 R) | S = 5 ms |
|---|---|---|---|
| 50% | 2 S | 9 S | 10 ms |
| 70% | 3,3 S | 15 S | 17 ms |
| 80% | 5 S | 23 S | 25 ms |
| 90% | 10 S | 46 S | 50 ms (p99 230 ms) |
| 95% | 20 S | 92 S | 100 ms (p99 460 ms) |
| 99% | 100 S | 460 S | 500 ms (p99 2,3 s) |

<p class="small">Chegadas aleatórias formam fila em rajadas; perto da saturação não há momentos tranquilos para se recuperar. A cauda explode primeiro.</p>

---

## Onde operar

| Componente | Meta no pico | Por quê |
|---|---|---|
| Sensível à latência (API, primário do banco) | **~50–70%** | à esquerda do joelho; sobrevive à perda de uma réplica |
| Workers em lote / assíncronos | 80–90%+ | importam throughput e custo, não a latência de cada job |

- **Folga é failover**: 4 réplicas a 60% → perde uma → 80%. A 80% → perde uma → **107%**.
- **Compartilhar a fila** (uma fila, muitos servidores) empurra o joelho para a direita.
- **Menos variabilidade** (admissão constante, sem casos lentos) significa menos fila — Kingman.

---

## Quando mais nós deixam de ajudar

> Amdahl: ganho ≤ **1/σ** · USL: C(N) = N / (1 + σ(N−1) + κN(N−1))

- **σ (contenção)**: trabalho serial — um primário, um lock global. 5% serial → nunca mais que **20×**.
- **κ (coerência)**: nós conversando entre si — locks distribuídos, coerência de cache. O throughput atinge um **pico** em N* = √((1−σ)/κ) e depois **cai**.

<div class="ok">

Shared-nothing escala: a BoxOffice particiona o inventário **por evento**, então reservas de eventos diferentes nunca disputam recursos.

</div>

---

## Por que médias mentem

- Distribuições de latência têm uma **cauda longa**: cache misses, pausas de GC, locks, novas tentativas.
- Exemplo: média **55 ms**, p50 **40 ms**, p99 **~500 ms**, p99.9 **~1,1 s**.
- Use **p50** (típico), **p99** / **p99.9** (os azarados — muitas vezes seus melhores clientes).
- Uma visita com 50 requisições pega ≥ 1 acima do p99 com probabilidade 1 − 0,99⁵⁰ ≈ **39%**.

<div class="warn">

**Nunca tire média de percentis** entre servidores ou no tempo — some os **histogramas**.

</div>

---

## O fan-out amplifica a cauda

> P(requisição do usuário lenta) = **1 − (1 − q)ᴺ**

| Fan-out N | q = 1% (p99 do backend) | q = 0,1% (p99.9) |
|---|---|---|
| 1 | 1% | 0,1% |
| 20 | 18% | 2% |
| 100 | **63%** | 9,5% |

<p class="small">"The Tail at Scale": com fan-out, a cauda do backend vira o caso comum do usuário (a mediana a partir de ~70 chamadas). A busca da BoxOffice consulta 20 shards em paralelo: 18 % das buscas veem o p99 de um shard.</p>

---

## Domando a cauda

- **Hedged requests**: segunda cópia depois do atraso do p95 → ~5% de carga extra, cauda muito menor (só leituras idempotentes).
- **Resultados parciais** depois de um prazo; **menos fan-out**; agregados pré-calculados.
- **Assíncrono** para tudo que não precisa terminar antes da resposta; **folga**.
- **Orçamento de latência** — checkout p99 1,5 s: borda 50 · order 50 · inventory 100 · payment **1.000** · gravação 50 · margem 250 ms.

<div class="warn">

**Omissão coordenada**: um gerador de carga que espera respostas lentas para de enviar — e a cauda some dos resultados.

</div>

---

## Disponibilidade e os noves

> A = MTTF / (MTTF + MTTR) — 720 h / 2 h → 99,72%; recuperação automática em 2 min → **99,995%**

| A | por ano | por 30,44 dias | por 28 dias |
|---|---|---|---|
| 99,9% | 8,77 h | 43,8 min | 40,3 min |
| 99,95% | 4,38 h | 21,9 min | 20,2 min |
| 99,99% | 52,6 min | 4,38 min | 4,03 min |
| 99,999% | 5,26 min | 26,3 s | 24,2 s |

<p class="small">Cada nove = 10× menos indisponibilidade. Sempre diga a janela. 99,9% de 2.000 req/s = 2 falhas a cada segundo.</p>

---

## Série e paralelo

- **Série** (todos necessários): **∏ aᵢ** — pior que o elo mais fraco. 0,999⁵ ≈ 99,5%.
- **Paralelo** (qualquer um basta): **1 − ∏(1 − aᵢ)** — dois a 99% → 99,99%.
- **Quórum** 2-de-3 a 99%: a³ + 3a²(1 − a) ≈ **99,97%**.

| Checkout da BoxOffice | Disponibilidade |
|---|---|
| ingênuo: 6 dependências síncronas, incl. e-mail a 99,5% | **99,19%** (~5,8 h/mês) |
| e-mail assíncrono | 99,69% |
| + segundo provedor de pagamento | 99,79% |
| + elos internos a 99,99% | **99,95%** |

---

## Independência é uma premissa

- 3 réplicas a 99,5% → "99,99999%"… até **uma versão ruim** atingir as três em 2 minutos.
- Falhas correlacionadas: mesma **zona**, mesma **versão**, mesma **configuração**, uma **dependência** compartilhada (DNS, certificado).
- Redundância precisa de **failover que funcione**: (detecção + troca) × falhas por ano.

<div class="ok">

Regra do nove extra: cada dependência crítica ~**um nove melhor** que o serviço. Transforme dependências rígidas em **suaves** (cache, fallback, assíncrono).

</div>

---

## A abertura de vendas, resolvida

- **Demanda**: 2 M de fãs / 60 s ≈ **33 mil reservas/s** (mais com cliques repetidos).
- **Capacidade**: 8 vagas / 5 ms = 1.600/s; a ≤ 70% → **~1.100/s**.
- **Veredito**: uma **diferença de 30×** — nenhum ajuste a fecha.
- **Design**: uma **sala de espera** admitindo ~1.000/s; ~30 mil fãs vencedores atendidos em ~30 s.

<div class="ok">

Um primário PostgreSQL basta **se** a demanda for moldada. O número-chave — **5 ms por reserva** — é uma premissa: o laboratório 2 o mede.

</div>

---

<!-- _class: tight -->

## O mapa de conceitos de estimativa

| Componente | Pergunta que responde | Conceitos-chave |
|---|---|---|
| `app` `worker` | quantas instâncias, threads, conexões? | pico / (capacidade × U) + reservas, L = λW |
| `sql` | um primário aguenta? | U = X × S, o joelho, fração serial (linhas quentes) |
| `cache` | quanta memória? quantos misses? | números de latência, o conjunto quente |
| `cdn` `objstore` | quantos Gbit/s e TB? | banda = QPS × tamanho, retenção × replicação |
| `queue` | qual o tamanho da fila? | W = L / λ, taxa de admissão |
| `search` (shards) | por que o p99 do usuário é pior? | 1 − (1 − q)ᴺ, hedging, orçamentos de latência |
| `lb` `healthcheck` `payment` | quão disponível é o caminho? | série ∏aᵢ, paralelo 1 − ∏(1 − aᵢ), MTTR |

<p class="small">A estimativa não adiciona caixas à paleta — ela coloca um <b>número</b> em cada caixa e diz qual número medir primeiro.</p>

---

## Pontos-chave

1. Estime para escolher **um lado do limiar**: decisão → premissas → potências de dez → conferência → conclusão.
2. RAM ~100 ns, SSD ~100 µs, zona ~0,5 ms, continente ~100+ ms; 1 dia ≈ 10⁵ s.
3. **Lei de Little** L = λW e **U = X·S** dimensionam pools, frotas e filas.
4. Latência ~ **S/(1 − ρ)**: rode as partes críticas em latência a ~50–70%.
5. Amdahl e **USL**: a coordenação limita a escala; particione para não compartilhar nada.
6. Use **percentis**; o fan-out transforma lentidão rara em lentidão comum.
7. Série **multiplica**, paralelo **1 − ∏(1 − a)**; as falhas costumam ser **correlacionadas**.
