# Números para saber { #numbers-to-know }

Uma folha de consulta com os números por trás de toda estimativa de guardanapo: tamanhos, latências, vazão de componentes comuns, disponibilidade, custos e o punhado de fórmulas que os transformam em decisões. O objetivo não é precisão — é a **ordem de grandeza certa, rápido**, com as suposições ditas em voz alta.

!!! warning "Leia os rótulos"
    Três tipos de número vivem nesta página. Valores **exatos** (potências de dois, segundos num dia, noves de disponibilidade) valem sempre. Os valores **clássicos** de latência vêm de referências conhecidas[^1][^2] e continuam sendo boa intuição. Tudo o que está marcado como **≈ ilustrativo** ou **aproximado (2026)** depende de hardware, carga, configuração e provedor: use para raciocinar, depois meça o seu próprio sistema (é para isso que serve o [Hands-on 2](../../hands-on/2/index.md)) e confira as calculadoras de preço dos provedores.

A teoria por trás destes números está em [Estimativas › Números](../../classes/estimation/numbers/index.md), [Filas](../../classes/estimation/queueing/index.md), [Percentis](../../classes/estimation/percentiles/index.md) e [Matemática da disponibilidade](../../classes/estimation/availability-math/index.md). O [catálogo de componentes](../components/index.md) traz números-chave por componente, e o [playground](../../../playground/index.md) usa as mesmas ordens de grandeza nos seus valores padrão.

---

## Potências de dois e unidades { #powers-of-two-and-units }

| Potência | Exato | ≈ Potência de dez | Nome | Exemplo |
|---|---|---|---|---|
| 2^10 | 1.024 | 10^3 | KiB (quilo) | Uma resposta JSON curta |
| 2^20 | 1.048.576 | 10^6 | MiB (mega) | Uma foto |
| 2^30 | 1.073.741.824 | 10^9 | GiB (giga) | Um filme; a RAM de uma VM pequena |
| 2^40 | ≈ 1,1 × 10^12 | 10^12 | TiB (tera) | Um banco de dados grande |
| 2^50 | ≈ 1,1 × 10^15 | 10^15 | PiB (peta) | O data lake de uma grande empresa |

- **Bits vs bytes**: redes são medidas em bits por segundo; 1 Gbps = 125 MB/s; 10 Gbps = 1,25 GB/s.
- **KB vs KiB**: fabricantes de armazenamento usam potências de dez (1 KB = 1.000 B); sistemas operacionais muitas vezes usam potências de dois (1 KiB = 1.024 B). Para estimativas, a diferença de 2,4% não importa.
- **Atalho**: mil → milhão → bilhão → trilhão é KB → MB → GB → TB. "1 milhão de usuários × 1 KB cada = 1 GB".

---

## Tempo { #time }

| Grandeza | Exato | Arredondado para estimativas |
|---|---|---|
| Segundos num minuto | 60 | — |
| Segundos numa hora | 3.600 | ≈ 4 × 10^3 |
| Segundos num dia | 86.400 | **≈ 10^5** |
| Segundos num mês (30 dias) | 2.592.000 | ≈ 2,5 × 10^6 |
| Segundos num ano | ≈ 31.557.600 | ≈ 3 × 10^7 (π × 10^7) |

### Requisições por dia → requisições por segundo { #requests-per-day-requests-per-second }

| Por dia | Média por segundo (÷ 86.400) | Regra prática (÷ 10^5) | Pico de 3× | Pico de 10× |
|---|---|---|---|---|
| 1 milhão | ≈ 11,6 | 10 | ≈ 35 | ≈ 116 |
| 10 milhões | ≈ 116 | 100 | ≈ 350 | ≈ 1.160 |
| 100 milhões | ≈ 1.157 | 1.000 | ≈ 3.500 | ≈ 11.600 |
| 1 bilhão | ≈ 11.574 | 10.000 | ≈ 35.000 | ≈ 116.000 |

!!! tip "Na entrevista"
    "Um dia tem cerca de 10^5 segundos, então 100 milhões de requisições por dia são cerca de 1.000 por segundo em média; vou dimensionar para um pico de 3×, a menos que o tráfego seja em rajadas — uma venda relâmpago não é 3×, é 100× num minuto."

---

## Latência { #latency }

### A tabela clássica { #the-classic-table }

A tabela popularizada por Jeff Dean e Peter Norvig[^1][^2]. O hardware mudou (veja a próxima tabela), mas são as **proporções** que você precisa lembrar: a memória é cerca de 1.000× mais rápida que uma leitura de SSD, e uma ida e volta dentro de um data center é cerca de 1.000× mais rápida que uma ida e volta atravessando um oceano.

| Operação | Valor clássico | Observações |
|---|---|---|
| Referência ao cache L1 | 0,5 ns | |
| Erro de previsão de desvio | 5 ns | |
| Referência ao cache L2 | 7 ns | |
| Travar/destravar um mutex | 25 ns | |
| Referência à memória principal | 100 ns | |
| Comprimir 1 KB com um compressor rápido | 3 µs | |
| Enviar 1 KB por uma rede de 1 Gbps | 10 µs | |
| Ler 4 KB aleatórios de um SSD | 150 µs | |
| Ler 1 MB sequencial da memória | 250 µs | |
| Ida e volta dentro do mesmo data center | 500 µs | |
| Ler 1 MB sequencial de um SSD | 1 ms | |
| Seek de disco (HDD) | 10 ms | |
| Ler 1 MB sequencial de um HDD | 20 ms | |
| Enviar um pacote Califórnia → Holanda → Califórnia | 150 ms | |

### Aproximações dos anos 2020 { #2020s-approximations }

Aproximado (2026), para hardware típico de nuvem[^3]. Meça o seu ambiente antes de confiar em qualquer um destes com mais precisão que um fator de 2–3.

| Operação | ≈ Valor | Observações |
|---|---|---|
| Referência à memória principal | ≈ 100 ns | Quase não mudou em 15 anos |
| Ler 1 MB sequencial da memória | ≈ 10–50 µs | Dezenas de GB/s de banda de memória |
| Leitura aleatória de 4 KB em SSD NVMe | ≈ 10–100 µs | Volumes de rede na nuvem: ≈ 0,5–2 ms |
| Ler 1 MB sequencial de NVMe | ≈ 0,1–0,3 ms | ≈ 3–7 GB/s |
| Ida e volta dentro de uma zona de disponibilidade | ≈ 0,1–0,5 ms | |
| Ida e volta entre AZs de uma região | ≈ 1–2 ms | |
| `GET` no Redis pela rede (mesma AZ) | ≈ 0,2–1 ms | Quase tudo é rede; o Redis em si leva microssegundos |
| Busca indexada no PostgreSQL (linha em memória) | ≈ 1–5 ms de ponta a ponta | Rede + parsing + execução |
| A luz percorre 1.000 km na fibra | ≈ 5 ms só de ida | ≈ 200.000 km/s no vidro |
| Ida e volta São Paulo ↔ leste dos EUA (Virgínia) | ≈ 110–130 ms | Física: ≈ 7.500 km em cada sentido |
| Ida e volta São Paulo ↔ Europa Ocidental | ≈ 180–220 ms | |
| Handshake TLS (conexão nova) | 1–2 idas e voltas extras | Por isso reutilizar conexões e terminar na borda importa |
| Tempo até o primeiro token de um LLM (modelo hospedado) | ≈ 0,2–2 s | ≈ ilustrativo; depois ≈ 30–150 tokens/s |

!!! example "Por que o BoxOffice coloca uma CDN em São Paulo"
    Um fã em São Paulo carregando a página do evento a partir de uma origem na Virgínia paga ≈ 120 ms por ida e volta; uma conexão TLS mais a requisição custam 2–3 idas e voltas ≈ 300 ms antes do primeiro byte. A partir de um ponto da CDN em São Paulo, as mesmas idas e voltas custam ≈ 5–20 ms cada.

---

## Vazão de componentes comuns { #throughput-of-common-components }

!!! warning "Ordem de grandeza, ilustrativo, depende do hardware e da carga"
    São números aproximados por instância para operações **simples** numa máquina de tamanho razoável. Tamanho do payload, complexidade da consulta, configurações de durabilidade (fsync), TLS, número de conexões e o próprio cliente os movem em 10× para qualquer lado. Use-os para saber se você precisa de 1 máquina ou de 100, nunca como promessa. Valores tirados de limites documentados pelos fornecedores estão marcados como *documentado*.

| Componente | ≈ Vazão por instância | Observações |
|---|---|---|
| Nginx / Envoy (proxy, respostas pequenas) | 10^4 – 10^5 req/s | Limitado por CPU e TLS |
| Servidor de aplicação (CRUD com uma chamada ao banco) | 10^2 – 10^4 req/s | Normalmente limitado pelo banco ou por threads × latência (Lei de Little) |
| PostgreSQL / MySQL, leituras indexadas simples | 10^4 – 10^5 consultas/s | Instância grande, dados em memória |
| PostgreSQL / MySQL, transações de escrita | 10^3 – 10^4 tx/s | Limitado por fsync e disputa; numa linha quente, muito menos |
| Redis (instância única) | ≈ 10^5 ops/s; até ≈ 10^6 com pipelining | Laço de comandos single-threaded; use cluster para escalar |
| Memcached | 10^5 – 10^6 ops/s | Multithread |
| Broker Kafka | ≈ 10^5 – 10^6 mensagens pequenas/s; centenas de MB/s | Lotes e compressão fazem diferença |
| Nó RabbitMQ | 10^4 – 10^5 mensagens/s | Menos com persistência e confirmações |
| Nó Cassandra / ScyllaDB | 10^4 – 10^5 escritas/s | Escala quase linearmente com os nós |
| Nó Elasticsearch / OpenSearch | 10^2 – 10^4 consultas/s | Depende muito da consulta |
| Servidor de WebSocket | 10^4 – 10^5+ conexões abertas | Limitado por memória; conexões em geral ociosas |
| Partição do Amazon DynamoDB | 3.000 unidades de leitura / 1.000 de escrita por s | Limite por partição *documentado* |
| Prefixo do Amazon S3 | 3.500 escritas / 5.500 leituras por s | *Documentado* por prefixo; acrescente prefixos para escalar |
| AWS Lambda | 1.000 execuções simultâneas por região | Cota padrão da conta *documentada* (pode ser aumentada) |
| Link de rede | 1 Gbps = 125 MB/s; 10 Gbps = 1,25 GB/s | Conversões exatas |

---

## Tamanhos de armazenamento { #storage-sizes }

| Item | ≈ Tamanho | Observações |
|---|---|---|
| Caractere ASCII | 1 B | UTF-8: 1–4 B por caractere |
| Inteiro (int32 / int64) | 4 B / 8 B | |
| UUID | 16 B em binário, 36 B como texto | Guarde em binário quando puder |
| Timestamp | 8 B | `timestamptz` do PostgreSQL |
| Uma linha de assento do BoxOffice (ids, status, reserva) | ≈ 100 B | Mais o overhead dos índices |
| Uma linha de usuário ou de pedido | ≈ 0,5–1 KB | Com alguns campos de texto |
| Um post curto (280 caracteres + metadados) | ≈ 0,5–1 KB | |
| Linha de log estruturado | ≈ 200 B – 2 KB | |
| Vetor de embedding, 1.536 dimensões, float32 | ≈ 6 KB | dimensões × 4 B |
| Miniatura | ≈ 10–50 KB | |
| Foto (JPEG / WebP) | ≈ 0,2–3 MB | |
| Página web (HTML + JSON, sem imagens) | ≈ 50–200 KB | |
| 1 minuto de vídeo a 1 Mbps (≈ 480p) | 7,5 MB | 1 Mbps × 60 s ÷ 8 |
| 1 minuto de vídeo a 5 Mbps (≈ 1080p) | ≈ 38 MB | |
| 1 minuto de vídeo a 20 Mbps (≈ 4K) | ≈ 150 MB | |
| 1 minuto de áudio a 128 kbps | ≈ 1 MB | |

**Armazenamento por ano** = escritas por dia × tamanho × 365 × fator de replicação (muitas vezes 3) × margem de crescimento. Exemplo: 1 milhão de pedidos por dia × 1 KB × 365 × 3 ≈ 1,1 TB por ano.

---

## Disponibilidade { #availability }

| Disponibilidade | Fora do ar por ano | por mês (30,4 dias) | por semana | por dia |
|---|---|---|---|---|
| 99% ("dois noves") | 3,65 dias | 7,31 horas | 1,68 hora | 14,4 min |
| 99,5% | 1,83 dia | 3,65 horas | 50,4 min | 7,2 min |
| 99,9% ("três noves") | 8,77 horas | 43,8 min | 10,1 min | 1,44 min |
| 99,95% | 4,38 horas | 21,9 min | 5,04 min | 43,2 s |
| 99,99% ("quatro noves") | 52,6 min | 4,38 min | 1,01 min | 8,64 s |
| 99,999% ("cinco noves") | 5,26 min | 26,3 s | 6,05 s | 0,86 s |

Ano = 365,25 dias. Um SLO numa janela de 28 dias permite 0,1% × 40.320 min ≈ 40,3 min a 99,9%[^4].

**Combinando componentes**

- **Em série** (todos precisam funcionar): $A = A_1 \times A_2 \times \dots \times A_n$. Três serviços a 99,9% ⇒ ≈ 99,7%.
- **Em paralelo** (basta um): $A = 1 - (1 - A_1)(1 - A_2)\cdots$. Duas réplicas a 99% ⇒ 99,99% (se as falhas forem independentes — muitas vezes não são).
- **Disponibilidade esperada a partir das taxas de falha**: $A = \dfrac{MTTF}{MTTF + MTTR}$. Reduzir pela metade o tempo de reparo vale tanto quanto dobrar o tempo entre falhas.

---

## Fórmulas

| Fórmula | Significado | Exemplo |
|---|---|---|
| $L = \lambda W$ (Lei de Little) | Itens no sistema = taxa de chegada × tempo no sistema | 1.000 req/s × 0,2 s = 200 requisições em andamento ⇒ ≈ 200 threads/conexões |
| $\rho = \lambda / \mu$ | Utilização = taxa de chegada ÷ capacidade de serviço | 800 req/s numa capacidade de 1.000 ⇒ ρ = 0,8 |
| $W = \dfrac{S}{1 - \rho}$ (M/M/1) | O tempo no sistema cresce sem limite quando ρ → 1 | S = 10 ms: ρ 0,5 ⇒ 20 ms; 0,9 ⇒ 100 ms; 0,99 ⇒ 1 s |
| Servidores $= \lceil \lambda_{peak} / (\mu_{1} \cdot \rho_{target}) \rceil$ | Capacidade com folga | 7.000 req/s ÷ (1.000 × 0,7) ⇒ 10 servidores (+1 para falhas) |
| Carga no banco $= \lambda (1 - h)$ | As faltas de cache chegam ao banco | 10.000 req/s, h = 0,95 ⇒ 500 req/s |
| $\bar{t} = h\,t_{cache} + (1-h)\,t_{db}$ | Latência média com cache | 0,95 × 1 ms + 0,05 × 20 ms = 1,95 ms |
| $P(\text{slow}) = 1 - (1 - p)^n$ | Amplificação da cauda com fan-out | p = 1%, n = 100 chamadas ⇒ 63% das requisições pegam uma chamada lenta |
| $R + W > N$ | Leituras por quórum veem a última escrita | N = 3, W = 2, R = 2 |
| $2f + 1$ nós | O consenso tolera f falhas | 3 nós toleram 1; 5 toleram 2 |
| Aceleração $= \dfrac{1}{(1-p) + p/n}$ (Amdahl) | A aceleração paralela é limitada pela parte serial | p = 0,9, n = 10 ⇒ ≈ 5,3×; n → ∞ ⇒ 10× |
| Orçamento de erros $= (1 - SLO) \times$ janela | Falta de confiabilidade que você pode gastar | 99,9% numa janela móvel de 28 dias ⇒ 40,3 min |
| Banda $= \lambda \times$ tamanho | Bytes por segundo no fio | 1.000 req/s × 100 KB = 100 MB/s = 800 Mbps |

As fórmulas de filas e de percentis são deduzidas (e plotadas) em [Estimativas › Filas](../../classes/estimation/queueing/index.md) e [Percentis](../../classes/estimation/percentiles/index.md).

---

## Custos de nuvem (ilustrativos) { #cloud-costs-illustrative }

!!! warning "Aproximado, 2026, confira as calculadoras dos provedores"
    Preços de tabela típicos sob demanda numa região dos EUA, arredondados, para comparar **ordens de grandeza** entre opções de design. Os preços reais variam por provedor, região (São Paulo costuma ser mais cara que o leste dos EUA), família de instância, compromissos e descontos, e mudam com o tempo. Use as calculadoras oficiais (AWS Pricing Calculator, Google Cloud Pricing Calculator, Azure Pricing Calculator) para qualquer coisa que importe.

| Item | ≈ Preço | ≈ Por mês |
|---|---|---|
| VM de uso geral | USD 0,04–0,05 por vCPU-hora (com ≈ 4 GB de RAM por vCPU) | ≈ USD 30–35 por vCPU |
| PostgreSQL gerenciado, 2 vCPU / 8 GB, uma AZ | USD 0,15–0,40 por hora | ≈ USD 110–300; ≈ 2× em multi-AZ |
| Nó de Redis gerenciado, ≈ 6–13 GB | USD 0,15–0,35 por hora | ≈ USD 110–250 |
| Load balancer gerenciado | ≈ USD 0,02–0,03 por hora + unidades de uso | ≈ USD 20–40 + tráfego |
| Object storage (camada padrão) | ≈ USD 0,02–0,026 por GB-mês | 1 TB ≈ USD 20–26 |
| Saída de dados para a internet | ≈ USD 0,05–0,12 por GB | 10 TB ≈ USD 500–1.200 |
| Entrega por CDN | ≈ USD 0,02–0,09 por GB | Cai com o volume |
| Tráfego entre AZs | ≈ USD 0,01 por GB em cada sentido | Serviços conversadores somam |
| NAT gateway | ≈ USD 0,045 por hora + ≈ USD 0,045 por GB | ≈ USD 33 + tráfego |
| Funções serverless | ≈ USD 0,20 por milhão de invocações + ≈ USD 0,0000167 por GB-segundo | 10 M chamadas × 100 ms × 512 MB ≈ USD 10 |
| E-mail transacional | ≈ USD 0,10 por 1.000 e-mails | 1 M de e-mails ≈ USD 100 |
| LLM, modelos pequenos/rápidos | ≈ USD 0,05–1 por milhão de tokens de entrada | Tokens de saída custam várias vezes mais |
| LLM, modelos de fronteira | ≈ USD 1–15 por milhão de tokens de entrada; ≈ USD 5–75 por milhão de tokens de saída | Prompt caching e APIs em lote reduzem isso |

**Custo de uma requisição a um LLM** ≈ tokens de entrada × preço de entrada + tokens de saída × preço de saída. 2.000 tokens de entrada + 300 de saída num modelo a USD 3 / USD 15 por milhão ≈ USD 0,006 + 0,0045 ≈ **USD 0,01 por requisição** — 1 milhão de requisições ≈ USD 10.000. É por isso que o [LLM gateway](../components/ai/index.md#llmgw) faz cache e roteia para modelos menores. Mais em [Cloud-native › FinOps](../../classes/cloud-native/finops/index.md).

---

## Exemplo resolvido: a venda relâmpago do BoxOffice { #worked-example-the-boxoffice-flash-sale }

Um show num estádio abre as vendas às 10:00: **2 milhões de fãs, 60.000 assentos**. As suposições são ditas em voz alta e arredondadas; cada uma pode ser contestada pelo entrevistador.

| Passo | Suposição | Estimativa |
|---|---|---|
| Fãs por assento | 2 M ÷ 60 mil | ≈ 33 — a maioria dos fãs não vai conseguir ingresso |
| Pedidos | 2 assentos por pedido em média | ≈ 30.000 pedidos |
| Pico de leitura | 2 M de fãs atualizam a página do evento a cada ≈ 15 s nos primeiros minutos | 2 × 10^6 ÷ 15 ≈ **130.000 req/s** |
| Carga na origem atrás de uma CDN | taxa de acerto de 99% (página em cache por alguns segundos) | ≈ 1.300 req/s na origem |
| Banda na borda | ≈ 100 KB por visualização de página | 130.000 × 100 KB ≈ 13 GB/s ≈ 100 Gbps — trabalho para a CDN, nunca para a origem |
| Escritas de assento sem sala de espera | todos tentam nos primeiros 1–2 minutos | 60 mil reservas + retries em ≈ 100 s ⇒ **≈ 10^3 escritas/s nas mesmas linhas** — disputa |
| Admissão pela sala de espera | admitir 2.000 fãs por minuto no checkout | ≈ 33 fãs/s; com ≈ 50% de conversão ≈ 1.000 pedidos/min ⇒ esgota em ≈ 30 min |
| Escritas de assento com a sala de espera | 60 mil reservas + 60 mil confirmações em ≈ 30 min | ≈ 70 escritas/s — fácil para um único primário PostgreSQL |
| Fãs dentro do checkout (Lei de Little) | 33 fãs/s × ≈ 5 min por sessão | ≈ 10.000 sessões simultâneas; as reservas expiram após 10 min |
| Concorrência do pagamento (Lei de Little) | ≈ 17 pedidos/s × p99 de 3 s | ≈ 50 chamadas em andamento ⇒ um pool de ≈ 100 com folga |
| E-mails | 30 mil ingressos em 30 min | ≈ 17 e-mails/s — atrás de uma fila, dentro da cota do provedor |
| Armazenamento | 30 mil pedidos × 1 KB | ≈ 30 MB — armazenamento não é o problema |
| Custo da CDN | ≈ 5 MB por fã (primeiro carregamento + 40 atualizações) × 2 M | ≈ 10 TB ≈ USD 200–900 (aproximado, 2026) |

A estimativa aponta direto para o design: o pico de leitura é da **CDN**, a disputa é de uma **sala de espera** que transforma a multidão num fluxo constante, o assento precisa ser uma linha **fortemente consistente** com reserva atômica, e pagamento e e-mail são dependências **limitadas e assíncronas**. O design completo está no [estudo de caso de ingressos](../../classes/case-studies/ticketing/index.md); experimente os números no cenário [`flash-sale`](../../../playground/scenarios/index.md#flash-sale) do [playground](../../../playground/index.md).

[^1]: Jonas Bonér, "Latency Numbers Every Programmer Should Know" (compilação de valores de Jeff Dean e Peter Norvig), [gist.github.com/jboner/2841832](https://gist.github.com/jboner/2841832).
[^2]: Jeff Dean, "Designs, Lessons and Advice from Building Large Distributed Systems", palestra no LADIS 2009; Peter Norvig, "Teach Yourself Programming in Ten Years", [norvig.com/21-days.html](https://norvig.com/21-days.html).
[^3]: Colin Scott, "Latency Numbers Every Programmer Should Know" (interativo, extrapolado por ano), [colin-scott.github.io](https://colin-scott.github.io/personal_website/research/interactive_latency.html); documentação dos provedores de nuvem para os números de rede e armazenamento.
[^4]: Betsy Beyer et al. (orgs.), *Site Reliability Engineering*, O'Reilly, 2016 — Apêndice A, "Availability Table", [sre.google/books](https://sre.google/books/).
