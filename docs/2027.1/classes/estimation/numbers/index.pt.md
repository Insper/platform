
Quanto tempo leva para ler um lugar da memória? De um SSD? De um banco no mesmo data centre? De um servidor na Virgínia, com o fã em São Paulo? As respostas cobrem **oito ordens de grandeza** — de um nanossegundo a cem milissegundos — e a maioria das regras práticas de arquitetura ("ponha em cache", "agrupe as chamadas", "não chame outra região de forma síncrona") são apenas consequências dessa amplitude. Esta página reúne os números que vale a pena memorizar e mostra como transformá-los, junto com algumas premissas sobre os usuários, em requisições por segundo, armazenamento e banda.

---

## Potências de dois (e de dez) { #powers-of-two-and-ten }

Tamanhos de dados são potências de dois; estimativas são mais fáceis em potências de dez. Como 2¹⁰ = 1.024 ≈ 10³, você pode alternar livremente entre as duas para estimar:

| Potência de dois | Valor exato | ≈ Potência de dez | Unidade | Algo desse tamanho |
|---|---|---|---|---|
| 2¹⁰ | 1.024 | 10³ (mil) | 1 KB | uma resposta JSON curta; um registro de lugar ×10 |
| 2²⁰ | 1.048.576 | 10⁶ (milhão) | 1 MB | um pôster de evento (foto comprimida) |
| 2³⁰ | ≈ 1,07 × 10⁹ | 10⁹ (bilhão) | 1 GB | um ano de dados de lugares da BoxOffice (ilustrativo) |
| 2⁴⁰ | ≈ 1,10 × 10¹² | 10¹² (trilhão) | 1 TB | um banco grande num único nó |
| 2⁵⁰ | ≈ 1,13 × 10¹⁵ | 10¹⁵ (quatrilhão) | 1 PB | o catálogo de uma plataforma de vídeo |

A rigor, 2¹⁰ bytes é um **kibibyte** (KiB) e 10³ bytes é um quilobyte (kB); a diferença (2,4% no KB, 10% no TB) não importa para estimativas de guardanapo.

!!! warning "Bits vs bytes"

    Velocidades de rede são expressas em **bits** por segundo (uma interface de rede de "10 Gbit/s"); armazenamento e cargas úteis, em **bytes**. Divida por 8: um link de 10 Gbit/s carrega no máximo **1,25 GB/s**. Misturar os dois é o erro de estimativa mais comum.

### Tempo { #time }

| Período | Segundos | Arredonde para |
|---|---|---|
| 1 minuto | 60 | — |
| 1 hora | 3.600 | 4 × 10³ |
| 1 dia | 86.400 | **10⁵** |
| 1 mês (30 dias) | 2.592.000 | 2,5 × 10⁶ |
| 1 ano | 31.536.000 | 3 × 10⁷ |

Uma tabela de conversão útil, usando 1 dia ≈ 10⁵ s (o fator exato é 86.400, o que torna as taxas reais cerca de 15% maiores):

| Por dia | ≈ Por segundo (média) |
|---|---|
| 1 milhão | ~12 |
| 10 milhões | ~120 |
| 100 milhões | ~1.200 |
| 1 bilhão | ~12.000 |

---

## Números de latência que todo engenheiro deveria saber { #latency-numbers-every-engineer-should-know }

Em 2009, Jeff Dean (Google) popularizou uma lista de "números que todos deveriam saber" — o custo de operações básicas num computador e numa rede[^1]. O hardware mudou desde então (SSDs substituíram discos giratórios no caminho quente, as redes ficaram mais rápidas), mas as **proporções** se mantiveram notavelmente estáveis, porque alguns limites — a velocidade da luz, a física da memória — não melhoram. A tabela usa ordens de grandeza dos anos 2020, compiladas da lista de Dean, de suas atualizações posteriores[^2] e do *Systems Performance* de Gregg[^3]; o seu hardware pode diferir por 2–3×, o que não tem problema para estimativas.

| Operação | Latência (ordem de grandeza) | Se 1 ns fosse 1 segundo… |
|---|---|---|
| Referência ao cache L1 | ~1 ns | 1 s |
| Erro de predição de desvio | ~3 ns | 3 s |
| Referência ao cache L2 | ~4 ns | 4 s |
| Lock/unlock de mutex (sem contenção) | ~20 ns | 20 s |
| Referência à memória principal (RAM) | ~100 ns | 1,7 min |
| Comprimir 1 KB com um compressor rápido | ~2 µs | 33 min |
| Ler 1 MB sequencialmente da RAM | ~10–50 µs | 3–14 h |
| Leitura aleatória de 4 KB num SSD NVMe | ~20–100 µs | 6–28 h |
| Ida e volta dentro de um data centre / zona de disponibilidade | ~0,1–0,5 ms | 1–6 dias |
| Ler 1 MB sequencialmente de um SSD NVMe | ~0,2 ms | 2,3 dias |
| `GET` no Redis ou consulta SQL por chave primária, mesma zona (quase toda rede) | ~0,2–1 ms | 2–12 dias |
| Ida e volta entre zonas de disponibilidade de uma região | ~1–2 ms | 12–23 dias |
| Seek de disco giratório (HDD) | ~5–10 ms | 2–4 meses |
| Ler 1 MB sequencialmente de um HDD | ~5 ms | 2 meses |
| Ida e volta São Paulo ↔ costa leste dos EUA (Virgínia) | ~110–130 ms | ~4 anos |
| Ida e volta atravessando o Atlântico / Pacífico | ~80–200 ms | 3–6 anos |
| Handshake TCP + TLS com um servidor distante | 2–3 idas e voltas | — |

### O que a tabela ensina { #what-the-table-teaches }

1. **A memória é ~1.000× mais rápida que o SSD, e o SSD ~100× mais rápido que o HDD em leituras aleatórias.** É por isso que caches (o Redis mantém tudo em RAM) e índices em memória existem.
2. **Dentro de um data centre, a rede custa mais que o trabalho.** Um `GET` no Redis consome microssegundos de CPU no servidor; o que você espera é a ida e volta. Uma página que faz 50 chamadas sequenciais ao Redis gasta ~10–25 ms só em idas e voltas — **agrupe-as** (`MGET`, pipelining) ou use cache no próprio processo.
3. **Entre regiões, a física vence.** A luz na fibra óptica viaja a cerca de 200.000 km/s, isto é, **~5 µs por km**, então cada 100 km acrescentam cerca de **1 ms de ida e volta** antes de qualquer roteador ou servidor tocar no pacote. São Paulo–Virgínia são ~7.500 km em linha reta, então a ida e volta mínima teórica é de ~75 ms; as rotas reais dão ~110–130 ms. Nenhuma tecnologia remove isso: **evite chamadas síncronas entre regiões no caminho crítico** e atenda os usuários de perto (CDN, implantações regionais).
4. **Sequencial ganha de aleatório.** Ler 1 MB sequencialmente de um SSD custa mais ou menos o mesmo que algumas leituras aleatórias de 4 KB. Armazenamento estruturado em log, o log append-only do Kafka e o processamento em lote exploram isso.
5. **Idas e voltas se somam; a banda raramente limita requisições pequenas.** Para uma resposta de API de 2 KB, a latência é dominada pelas idas e voltas (abertura de conexão, TLS, a própria requisição), não pelo tempo de transferência. Reaproveitar conexões (keep-alive, HTTP/2) importa mais que um cano mais largo.

!!! example "BoxOffice — o mapa de lugares, de três jeitos"

    O mapa de lugares de um evento de estádio precisa de ~60.000 estados de lugar.

    - **60.000 consultas individuais** da aplicação ao PostgreSQL na mesma zona: 60.000 × ~0,5 ms ≈ **30 s**. Inutilizável.
    - **Uma consulta** retornando 60.000 linhas de ~50 bytes (3 MB): uma ida e volta + ~10–30 ms de trabalho do banco + ~3 ms para transferir num link de 10 Gbit/s ≈ **20–40 ms**.
    - **Um blob comprimido em cache** no Redis (~300 KB após compressão), atualizado a cada segundo: uma ida e volta + uma fração de milissegundo de transferência ≈ **1–2 ms**.

    Os mesmos dados, a quatro ordens de grandeza de distância — decididos inteiramente pelo número de idas e voltas e por onde os dados ficam.

---

## Regras práticas de throughput { #throughput-rules-of-thumb }

A latência diz quanto tempo *uma* operação leva; o planejamento de capacidade também precisa saber quantas operações *por segundo* um componente sustenta. Esses valores variam muito mais com hardware, configuração e carga do que as latências, então trate a tabela como **premissas iniciais ilustrativas** que você precisa substituir por medições (é para isso que serve o laboratório 2):

| Componente | Ordem de grandeza (operações simples, um nó) | O que limita |
|---|---|---|
| Servidor de aplicação (JVM, endpoint JSON simples) | 10³–10⁴ requisições/s | CPU por requisição, threads, chamadas a dependências |
| Nginx servindo conteúdo em cache/estático | 10⁴–10⁵ requisições/s | CPU, rede |
| Banco relacional, leituras por chave primária | 10⁴–10⁵ consultas/s | CPU, taxa de acerto do buffer cache |
| Banco relacional, transações de escrita duráveis | 10³–10⁴ commits/s | flush do log (fsync), locks |
| Redis, `GET`/`SET` simples | ~10⁵ operações/s por instância | laço de comandos single-threaded, rede |
| Kafka, uma partição | ordem de grandeza de ~10 MB/s | disco, rede, replicação |
| Interface de rede de 10 Gbit/s | 1,25 GB/s | o fio |

O padrão a lembrar: **leituras são mais baratas que escritas duráveis**, **memória é mais barata que disco** e **tudo que precisa gravar em disco ou atravessar a rede para confirmar** (escritas duráveis, replicação, consenso) tem um teto mais baixo.

---

## Tamanhos típicos { #typical-sizes }

| Item | Tamanho | Observação |
|---|---|---|
| Booleano / byte | 1 B | — |
| Inteiro / timestamp | 4–8 B | `bigint`, epoch em milissegundos |
| UUID | 16 B (36 B como texto) | armazene em binário quando puder |
| String curta (nome, e-mail) | 20–100 B | UTF-8 |
| Linha de lugar da BoxOffice | ~100 B | ids, status, preço, id da reserva, versão |
| Pedido da BoxOffice | ~1 KB | com itens e referência de pagamento |
| Evento da BoxOffice (descrição, metadados) | ~2–5 KB | — |
| Resposta JSON de API (uma página de resultados) | 2–50 KB | antes da compressão |
| PDF do ingresso | ~100 KB | — |
| Foto comprimida (pôster) | 200 KB – 2 MB | várias resoluções |
| 1 minuto de vídeo HD | 50–100 MB | depende do bitrate |
| Um vetor de embedding (1.024 dimensões × 4 B) | ~4 KB | relevante para bancos vetoriais (aula 13) |

Dois multiplicadores são fáceis de esquecer: **replicação** (um banco normalmente mantém 3 cópias; object stores replicam internamente) e **índices e overhead** (muitas vezes 1,5–2× os dados brutos num banco relacional).

---

## Estimando requisições por segundo (QPS) { #estimating-requests-per-second-qps }

**QPS** (*queries per second*, usado de forma livre para requisições por segundo) é o ponto de partida de toda estimativa de capacidade:

$$
\text{QPS}_{avg} = \frac{\text{usuários ativos diários} \times \text{ações por usuário por dia}}{86{,}400}
\qquad
\text{QPS}_{peak} = \text{QPS}_{avg} \times \text{fator de pico}
$$

- **Fator de pico**: o tráfego não é plano ao longo do dia. Para produtos de consumo, a hora mais movimentada costuma ser **2–3×** a média diária; é para esse número que você dimensiona. Para negócios movidos a eventos, o pico é um **salto repentino** que nada tem a ver com a média diária — estime-o separadamente.
- **Proporção leitura/escrita**: divida as ações em leituras e escritas. Leituras podem ir para cache e ser replicadas; escritas vão para um primário. Um produto com 100:1 e outro com 1:1 são designs diferentes.

!!! example "BoxOffice — requisições por segundo (premissas em itálico)"

    **Dia normal**

    - *20 M de fãs cadastrados, 2 M ativos por dia; cada um vê ~20 páginas (eventos, mapas de lugares, buscas).*
    - Leituras: 2 M × 20 = 4 × 10⁷ por dia → 4 × 10⁷ / 10⁵ ≈ **400 leituras/s** em média.
    - *Hora de pico ≈ 3× a média* → **~1.200 leituras/s**.
    - Escritas: *100 mil pedidos/dia*, cada um com ~5 escritas (reserva, pedido, pagamento, ingressos, outbox) → 5 × 10⁵ / 10⁵ ≈ **5 escritas/s** em média, ~15 no pico.
    - Proporção leitura/escrita ≈ **100:1** → cache e réplicas para as leituras; um único primário atende as escritas com folga.

    **Pico da abertura de vendas**

    - *2 M de fãs chegam nos primeiros 60 s; cada um envia ~3 requisições nesse minuto (página, atualização, tentativa de reserva).*
    - 2 × 10⁶ × 3 / 60 ≈ **100.000 requisições/s** na borda — **~80× o pico normal**, por alguns minutos.
    - Existem só 60 mil lugares: no máximo ~30 mil fãs conseguem comprar (2 lugares cada). Quase todo o pico precisa ser absorvido **antes** de chegar ao inventário: CDN para o conteúdo estático, cache para a página do evento, sala de espera para as reservas.

---

## Estimando armazenamento { #estimating-storage }

$$
\text{armazenamento} = \text{itens por dia} \times \text{tamanho por item} \times \text{retenção (dias)} \times \text{fator de replicação} \;(\times \text{overhead de índices})
$$

!!! example "BoxOffice — armazenamento para 5 anos"

    | Dado | Volume | Tamanho de cada | Por ano | 5 anos, ×3 réplicas | Onde |
    |---|---|---|---|---|---|
    | Pedidos | 100 mil/dia | 1 KB | 100 MB/dia × 365 ≈ **37 GB** | ≈ 550 GB | SQL |
    | Lugares | *20 mil eventos/ano × 5 mil lugares* = 10⁸ linhas | 100 B | **10 GB** | ≈ 150 GB | SQL (quente só durante a abertura de vendas) |
    | PDFs de ingressos | 200 mil ingressos/dia | 100 KB | 20 GB/dia ≈ **7 TB** | object store (replicado internamente) ≈ 35 TB | Object Store |
    | Imagens de eventos | 20 mil eventos × 5 imagens | 1 MB | **100 GB** | ≈ 0,5 TB | Object Store + CDN |
    | Logs de acesso | 10⁸ requisições/dia | 500 B | 50 GB/dia ≈ **18 TB** | 30 dias quentes ≈ 1,5 TB | plataforma de logs / object store |

    **Conclusões**: os dados transacionais (pedidos, lugares) ficam **bem abaixo de um terabyte** mesmo após 5 anos com réplicas — um único primário PostgreSQL com réplicas dá conta; particionar não é requisito do primeiro dia. Os dados **volumosos** são arquivos e logs, que pertencem a um object store (barato, durável, praticamente ilimitado) — e você pode decidir gerar os PDFs dos ingressos sob demanda em vez de armazenar 35 TB deles.

---

## Estimando banda { #estimating-bandwidth }

$$
\text{banda} = \text{requisições por segundo} \times \text{bytes por resposta}
$$

!!! example "BoxOffice — banda no pico normal"

    - Respostas de API: 1.200 req/s × 20 KB ≈ 24 MB/s ≈ **0,2 Gbit/s** — trivial para a origem.
    - Imagens: cada visualização de página carrega ~1 MB de imagens → 1.200 × 1 MB ≈ 1,2 GB/s ≈ **10 Gbit/s** — satura um link de 10 Gbit/s e custa caro em tráfego de saída. Sirva as imagens por uma **CDN**: com 95% de acerto na borda, a origem envia só ~0,5 Gbit/s.
    - Pico da abertura de vendas: 100 mil req/s × 5 KB (uma página leve de sala de espera) ≈ 500 MB/s ≈ **4 Gbit/s** — precisa ser servido pela borda (CDN ou edge compute), não pelos servidores de aplicação.

---

## Estimando servidores e memória { #estimating-servers-and-memory }

Quando você sabe a carga de pico e a capacidade por nó, o número de nós sai direto — com **folga** e **redundância**:

$$
\text{nós} = \left\lceil \frac{\text{QPS de pico}}{\text{capacidade por nó} \times \text{utilização-alvo}} \right\rceil + \text{reservas}
$$

- **Utilização-alvo** de 60–75% para serviços sensíveis à latência — a página de [filas](../queueing/index.md) explica por que rodar perto de 100% destrói o p99.
- **Reservas** (N+1, N+2): se um nó falhar ou estiver em deploy, os outros precisam absorver sua carga sem passar do joelho.

Para a **memória de cache**, uma regra prática comum é a regra 80/20: uma pequena fração dos itens recebe a maior parte do tráfego, então guardar em cache o **conjunto quente** — muitas vezes ~20% dos itens, às vezes bem menos — captura a maioria das leituras.

!!! example "BoxOffice — servidores do catálogo e cache"

    - *Uma instância do catálogo atende ~1.000 req/s a 100% de CPU (a medir).* Pico de 1.200 req/s com alvo de 60% → 1.200 / 600 = 2 → **2 + 1 reserva = 3 instâncias**.
    - Conjunto quente: *os ~2.000 eventos à venda neste mês × 5 KB* (JSON do evento) + resumos de mapas de lugares (~300 KB cada) ≈ 10 MB + 600 MB ≈ **~0,6 GB** — cabe numa instância pequena de Redis com uma réplica.

!!! example "No código do BoxOffice: um nó, dimensionado e depois medido (labs 1 e 2)"

    A estimativa acima *supõe* 1.000 req/s por instância do catálogo. Os laboratórios trocam a suposição por uma medição. O [Hands-on 1](../../../hands-on/1/container/index.md) fixa o tamanho de um nó — 1 CPU, 768 MB e um pool de 10 conexões com o banco — e o [Hands-on 2](../../../hands-on/2/index.md) mede o que ele atende: na execução de exemplo do laboratório, o p99 ficou abaixo de 40 ms até 300 req/s, chegou a 224 ms em 400 req/s e a 2 s em 500 req/s. A capacidade com p99 < 300 ms é, portanto, **~400 req/s**, não 1.000. Refaça a conta: 1.200 / (400 × 0,6) = 5 → **5 + 1 reserva = 6 instâncias**, o dobro da primeira resposta — e o [lab 3](../../../hands-on/3/index.md#measure-it) mostra que elas só ajudam enquanto o PostgreSQL compartilhado aguenta.

    ``` { .yaml title="docker-compose.yaml (the size of one catalog node)" }
    --8<-- "docs/2027.1/hands-on/1/code/docker-compose.yaml:21:39"
    ```

??? question "Pense antes: estime um encurtador de URLs"

    100 M de novas URLs curtas por mês; leituras são 100× as escritas; cada registro tem ~500 B; manter por 5 anos.

    **Esboço de resposta**

    - Escritas: 10⁸ / (2,5 × 10⁶ s) ≈ **40 escritas/s**; leituras ≈ **4.000 leituras/s** (pico ×2–3 → ~10 mil/s).
    - Armazenamento: 10⁸ × 12 × 5 = 6 × 10⁹ registros × 500 B = **3 TB** (≈ 9 TB com 3 réplicas).
    - Implicações: as leituras dominam e são altamente cacheáveis (links populares) → cache; 3 TB é grande para o working set de um nó, então planeje particionamento ou um banco chave-valor; espaço de chaves: 6 × 10⁹ URLs precisam de ≥ 6 caracteres em base 62 (62⁶ ≈ 5,7 × 10¹⁰). O [estudo de caso](../../case-studies/url-shortener/index.md) desenvolve o problema.

!!! tip "Na entrevista"

    Leve um pequeno "cartão de números" na cabeça: **1 dia ≈ 10⁵ s; 1 M/dia ≈ 12/s; RAM ~100 ns; SSD ~100 µs; ida e volta na mesma zona ~0,5 ms; entre continentes ~100+ ms; 1 Gbit/s ≈ 125 MB/s**. Escreva as premissas antes dos resultados, arredonde tudo para um algarismo significativo e termine cada linha com sua consequência. Se não tiver certeza de um número, diga isso e dê uma faixa: "uma busca por chave primária leva em torno de um milissegundo incluindo a rede — vamos dizer 1 ms."

!!! success "Boas práticas"

    - **Mantenha unidades em toda linha e um algarismo significativo em todo resultado** — "4 × 10⁷ leituras/dia ≈ 400 leituras/s"; as unidades pegam a maioria dos erros antes que cheguem a uma decisão.
    - **Troque cada capacidade de regra de bolso por uma medida antes de dimensionar uma frota** — a medição é barata, a frota errada não. Na BoxOffice: os ~400 req/s do lab 2 substituíram os 1.000 supostos (quadro acima).
    - **Fixe a CPU e a memória de todo contêiner** — limites fazem da "capacidade por nó" uma propriedade do deploy, não do laptop de quem rodou o teste. Na BoxOffice: `cpus: "1.0"` e `memory: 768M` no [compose do lab 1](../../../hands-on/1/container/index.md).
    - **Ponha o egress ao lado da banda** — todo gigabyte que sai da nuvem é cobrado; a taxa de acerto da CDN e o preço do egress pertencem à mesma linha da planilha.
    - **Mantenha uma folha de números da equipe com a fonte de cada número** — latências, vazões e preços mudam com o hardware e os provedores; uma fonte datada diz quando atualizá-la.

!!! warning "Armadilhas comuns"

    - **Tratar números de latência como exatos**: são ordens de grandeza; o seu hardware e a sua nuvem serão diferentes.
    - **Esquecer as idas e voltas**: 100 chamadas sequenciais de 0,5 ms são 50 ms, mesmo que cada chamada quase não faça nada.
    - **Dimensionar para a média diária** em vez do pico — ou esquecer o pico repentino.
    - **Ignorar replicação, índices e retenção** no armazenamento.
    - **Bits vs bytes**, e **86.400 vs 10⁵** quando a precisão importa (por exemplo, em cálculos de SLA — use o valor exato aí).

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    P2["potências de dois e de dez<br/>1 dia ≈ 10⁵ s"] --> QPS["QPS: média e pico<br/>o pico estimado à parte"]
    LAT["números de latência<br/>RAM, SSD, rede"] --> CACHE["cachear o conjunto quente<br/>→ Caching"]
    LAT --> RT["contar idas e voltas<br/>→ Protocolos da borda"]
    QPS --> NODES["nós = pico / capacidade × U<br/>+ reservas → Compute"]
    QPS --> BW["banda = QPS × tamanho<br/>→ CDN"]
    SIZES["tamanhos típicos"] --> STO["armazenamento × retenção<br/>× replicação"]
    STO --> SHARD["particionar ou não?<br/>→ Bancos de dados"]
    STO --> OBJ["arquivos e logs volumosos<br/>→ object store"]
    NODES --> KNEE["utilização-alvo<br/>→ Filas"]
```

**Componentes da paleta:** [`app`](../../../reference/components/compute/index.md#app) (instâncias = pico / capacidade por nó, mais reservas) · [`sql`](../../../reference/components/storage/index.md#sql) (pedidos e assentos ficam abaixo de um terabyte; o teto de escritas duráveis) · [`cache`](../../../reference/components/storage/index.md#cache) (o conjunto quente, ~0,6 GB para o catálogo) · [`cdn`](../../../reference/components/edge/index.md#cdn) (banda das imagens fora da origem) · [`objstore`](../../../reference/components/storage/index.md#objstore) (PDFs de ingressos, imagens, logs) · [`kafka`](../../../reference/components/messaging/index.md#kafka) (~10 MB/s por partição) · [`vectordb`](../../../reference/components/storage/index.md#vectordb) (~4 KB por embedding). **Cenários:** `monolith`, `read-heavy-cache`, `cdn-static`, `url-shortener`. **Continua em:** [Filas](../queueing/index.md), [Borda — DNS e CDN](../../edge/dns-cdn/index.md), [Caching](../../caching/index.md), [Bancos de dados — particionamento](../../databases/partitioning/index.md), [Estudo de caso: encurtador de URL](../../case-studies/url-shortener/index.md), [Exercício: estimativa](../../../exercises/estimation/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - 2¹⁰ ≈ 10³; 1 dia ≈ 10⁵ s; 1 M por dia ≈ 12 por segundo.
    - As latências cobrem oito ordens de grandeza: **RAM ~100 ns, SSD ~100 µs, rede na mesma zona ~0,5 ms, entre continentes ~100 ms**; a maioria das regras de design segue dessas proporções.
    - QPS = usuários × ações / 86.400 × fator de pico; **estime os picos repentinos separadamente**.
    - Armazenamento = itens × tamanho × retenção × replicação (× overhead); banda = QPS × tamanho.
    - Nós = pico / (capacidade × utilização-alvo) + reservas; coloque em cache o **conjunto quente**.

---

[^1]: DEAN, J. *Designs, Lessons and Advice from Building Large Distributed Systems*. Keynote, LADIS workshop, 2009 ("numbers everyone should know").
[^2]: SCOTT, C. [Latency numbers every programmer should know (interactive)](https://colin-scott.github.io/personal_website/research/interactive_latency.html){target="_blank"}, University of California, Berkeley.
[^3]: GREGG, B. *Systems Performance: Enterprise and the Cloud*, 2nd ed. Addison-Wesley, 2020. Chapter 2 (methodologies: latency scale and known numbers).
