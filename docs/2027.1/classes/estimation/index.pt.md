
A equipe da BoxOffice está discutindo a abertura de vendas do estádio. *"Um PostgreSQL não aguenta isso, precisamos de um banco distribuído."* — *"Claro que aguenta, o Postgres é rápido."* Os dois engenheiros estão chutando. Nenhum deles disse quantas requisições por segundo a abertura de vendas gera, por quanto tempo uma reserva de lugar mantém o banco ocupado, quão cheio o banco pode rodar antes de a latência explodir, ou o que acontece com a experiência dos fãs quando uma das dez chamadas por trás de uma página fica lenta.

Esta aula dá as ferramentas para encerrar essa discussão em cinco minutos num quadro branco: os **números** que todo engenheiro deveria ter na cabeça, as **fórmulas** que ligam carga, latência e capacidade, e os **métodos** para transformar uma pergunta vaga ("vai aguentar?") numa resposta em ordem de grandeza que guia uma decisão de design. São as mesmas ferramentas que você vai usar para ler testes de carga (laboratório 2 e [aula 15](../performance/index.md)), dimensionar clusters (aula 11), definir SLOs (aula 9) e passar pela etapa de estimativas de uma entrevista de system design.

!!! quote "A história até aqui"

    Capítulo 2 da [história da disciplina](../../index.md#story). A [aula 1](../intro/index.md) escreveu o que a BoxOffice precisa fazer e quão bem: 2 milhões de fãs no primeiro minuto, 60.000 lugares, p99 da reserva < 300 ms. A BoxOffice ainda roda num serviço e num PostgreSQL. **Esta aula** responde: esse banco aguenta a abertura das 10:00 — e como saber isso antes de construir qualquer coisa?

!!! abstract "Objetivos de aprendizagem"

    Ao final desta aula, você deve ser capaz de:

    - **Lembrar** as ordens de grandeza de latência (memória, SSD, rede dentro de um data centre, entre continentes) e de tamanhos de dados comuns, e **usar** potências de dois e de dez com fluência.
    - **Estimar** requisições por segundo (média e pico), armazenamento, banda e número de servidores de um sistema a partir de poucas premissas declaradas.
    - **Aplicar** a Lei de Little e a lei da utilização para dimensionar pools de threads, pools de conexões e filas, e para validar um teste de carga.
    - **Explicar** por que a latência explode perto da utilização máxima (o joelho) e **escolher** uma utilização de operação segura.
    - **Interpretar** percentis de latência (p50, p99, p99.9), **calcular** a amplificação da cauda sob fan-out e **propor** técnicas tolerantes à cauda.
    - **Calcular** a disponibilidade de componentes em série e em paralelo e a indisponibilidade permitida por um número de noves; **raciocinar** sobre limites de escalabilidade com a lei de Amdahl e a Universal Scalability Law.

## Roteiro { #roadmap }

1. **Esta visão geral** — por que estimar, o método em cinco passos e uma verificação de capacidade completa, de guardanapo, para a abertura de vendas.
2. [Números que Todo Engenheiro Deveria Saber](numbers/index.md) — potências de dois, números de latência, tamanhos e como estimar requisições por segundo, armazenamento e banda.
3. [Filas, Lei de Little e Escalabilidade](queueing/index.md) — concorrência, utilização, o joelho da curva de latência, Amdahl e a Universal Scalability Law.
4. [Percentis e Latência de Cauda](percentiles/index.md) — por que médias mentem, como o fan-out amplifica a cauda e como combatê-la.
5. [Matemática da Disponibilidade](availability-math/index.md) — noves, MTTF/MTTR, componentes em série e em paralelo, falhas correlacionadas.
6. [Quiz](quiz.md) — verifique seu entendimento.

## Slides

<div class="slides-embed">
  <iframe src="slides/estimation.html" title="Slides: estimativas de guardanapo" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/estimation.html){:target="_blank"}

---

## Por que estimar? { #why-estimate }

Decisões de arquitetura diferem em **ordens de grandeza**, não em porcentagens. Um design para 10 requisições por segundo e outro para 10.000 são designs diferentes; 40 GB e 40 TB de dados são problemas diferentes. Raramente você precisa do número exato — precisa saber **de que lado de um limiar** você está:

| Se a estimativa diz… | …a decisão de design é |
|---|---|
| 40 GB de pedidos por ano | um único primário PostgreSQL basta por anos — **não particione** |
| 1.200 leituras/s do catálogo, 99% repetidas | **coloque em cache**; o banco só vê os misses |
| 100.000 tentativas de reserva/s para 60.000 lugares | o inventário não consegue absorver — **enfileire** os fãs numa sala de espera |
| 8 Gbit/s de imagens | sirva-as por uma **CDN**, não pelos servidores de aplicação |
| uma dependência síncrona a 99,9% em toda requisição | o serviço não pode prometer mais que 99,9% — **tire-a do caminho crítico** ou torne-a redundante |

Estimar é também como você **confere** um design e uma medição. Se o seu teste de carga diz que um servidor atende 50.000 requisições por segundo enquanto cada requisição leva 20 ms numa única thread, há algo errado com o teste — e a Lei de Little vai lhe dizer isso em uma linha.

## O método: cinco passos { #the-method-five-steps }

A estimativa de guardanapo (*back-of-the-envelope*) é uma forma de **estimativa de Fermi** (em homenagem ao físico Enrico Fermi, famoso por estimar quantidades como "quantos afinadores de piano existem em Chicago?" a partir de uma cadeia de palpites razoáveis). Os erros numa cadeia de palpites grosseiros tendem a se compensar em parte, e uma resposta dentro de um fator de 2–3 é boa o bastante para escolher entre designs que diferem por 10× ou mais[^1].

1. **Dê nome à decisão.** O que o número vai decidir? "Precisamos particionar a tabela de pedidos?" — e não "quantos dados existem?".
2. **Declare as premissas** em voz alta e anote-as: usuários, ações por usuário, tamanhos, fator de pico. Use números redondos.
3. **Calcule com potências de dez.** Um dia ≈ 10⁵ segundos; 1 milhão por dia ≈ 12 por segundo. Mantenha um algarismo significativo.
4. **Confira a sanidade** contra um número que você conhece: "1.200 req/s — é mais ou menos o que um servidor de aplicação bem ajustado atende; OK, alguns servidores."
5. **Conclua**: diga a implicação para o design e a premissa à qual ela é mais sensível.

!!! tip "Regras de arredondamento que mantêm você rápido"

    - 1 dia = 86.400 s ≈ **10⁵ s**; 1 mês ≈ **2,5 × 10⁶ s**; 1 ano ≈ **3 × 10⁷ s**.
    - 1 milhão de requisições por dia ≈ **12 por segundo** em média.
    - 2¹⁰ ≈ 10³: KB, MB, GB, TB, PB são, cada um, ~1.000× o anterior.
    - Mantenha os expoentes, arredonde as mantissas: 2 M × 20 = 4 × 10⁷; 4 × 10⁷ / 10⁵ = **400**.

---

## Uma verificação de capacidade completa: um banco aguenta a abertura de vendas? { #a-complete-capacity-check-can-one-database-take-the-on-sale }

Vamos encerrar a discussão do início da página. Cada passo usa uma ferramenta de uma das subpáginas — siga os links quando um passo ainda não for óbvio.

!!! example "BoxOffice — a abertura de vendas das 10:00 em um único banco de inventário"

    **Decisão**: um único primário PostgreSQL basta para o inventário de lugares durante uma abertura de vendas de estádio, ou precisamos de outra coisa?

    **Premissas** (ilustrativas, a validar com um teste de carga no laboratório 2):

    - 2 M de fãs chegam nos primeiros 60 s; 60 mil lugares; cada fã bem-sucedido reserva 2 lugares em média.
    - Uma transação de reserva de lugar mantém o banco ocupado por **S = 5 ms** (um `UPDATE` condicional em poucas linhas, mais o commit).
    - O banco consegue rodar cerca de **c = 8** dessas transações em paralelo de forma produtiva (núcleos de CPU e a contenção de locks de linha o limitam).

    **1. Demanda** ([números](numbers/index.md)): 2 M de fãs / 60 s ≈ **33.000 tentativas de reserva por segundo**, se cada fã clicar uma vez — e eles clicam mais de uma vez.

    **2. Capacidade** ([filas](queueing/index.md)): cada "vaga" conclui 1 / 5 ms = 200 reservas/s; 8 vagas ≈ **1.600 reservas/s** a 100% de utilização. Para manter a latência razoável, rodamos a ≤ 70%: **≈ 1.100 reservas/s**.

    **3. Veredito**: a demanda excede a capacidade em **~30×**. Nenhum ajuste fecha uma diferença de 30×. Sem uma fila, as requisições se acumulam, a latência explode muito antes de os erros aparecerem, e os timeouts provocam novas tentativas que pioram tudo.

    **4. Design**: uma **sala de espera** admite fãs a ~1.000/s. Com 60 mil lugares e ~2 lugares por fã, são necessários no máximo ~30 mil fãs bem-sucedidos; a 1.000 admissões por segundo, eles são atendidos em cerca de 30 s, enquanto a fila diz aos demais, quase em tempo real, quão longe estão da frente — e, quando os lugares acabam, que o show esgotou.

    **5. Confira a experiência** ([percentis](percentiles/index.md), [disponibilidade](availability-math/index.md)): a reserva de um fã admitido passa por gateway → inventory → banco; a 70% de utilização, com os 8 slots dividindo uma fila (M/M/c), o p99 do banco fica em cerca de 25 ms — alguns múltiplos de 5 ms, bem dentro da meta de 300 ms (um slot sozinho a 70% daria 15 × 5 ms ≈ 75 ms, veja a [tabela de filas](queueing/index.md)). E, como a abertura de vendas depende de todos eles em série, cada um precisa ser mais disponível que os 99,95% prometidos para o checkout.

    **Conclusão**: um primário PostgreSQL basta **se** uma sala de espera moldar a demanda; um "banco distribuído" não eliminaria a contenção nas linhas quentes, já que todo mundo quer os mesmos lugares.

Repare que o número mais importante — **5 ms por reserva** — é uma premissa. A estimativa diz *qual* número medir primeiro. O laboratório 2 o mede.

### Veja no playground { #see-it-in-the-playground }

O cenário `monolith` é um único servidor de aplicação e um único banco SQL. O perfil `breakpoint` aumenta a carga continuamente até algo quebrar — a forma padrão de encontrar a capacidade de um sistema.

**Experimente:** rode o perfil breakpoint e acompanhe três curvas ao mesmo tempo: throughput, latência p99 e utilização do banco. Anote a taxa de requisições em que o **p99 começa a subir bruscamente** (o joelho, *knee*) e a taxa em que **os erros aparecem**. Depois leia o tempo de serviço do banco no painel do componente e calcule sua capacidade à mão (capacidade = vagas paralelas / tempo de serviço). Quão perto o joelho fica de ~70–80% dessa capacidade?

<div class="sdp" data-scenario="monolith" data-mode="compact" data-profile="breakpoint" data-height="520"></div>

??? question "O que você deveria ter observado? (abra depois de experimentar)"

    O throughput cresce linearmente com a carga oferecida enquanto a latência fica plana; então, à medida que o componente mais carregado se aproxima da saturação, **a latência se curva para cima** (o joelho) enquanto o throughput se achata. Depois da saturação, o throughput para de crescer, as filas crescem sem limite e os timeouts viram erros. A latência é o **aviso precoce**; os erros são o aviso **tardio**. É por isso que a capacidade é definida pela meta de latência ("o maior throughput em que o p99 < 300 ms"), e não pelo ponto em que o sistema cai. A página de [filas](queueing/index.md) deduz a forma da curva.

---

## A caixa de ferramentas num relance { #the-toolbox-at-a-glance }

| Pergunta | Ferramenta | Fórmula / regra | Subpágina |
|---|---|---|---|
| Quantas requisições por segundo? | estimativa de QPS | DAU × ações / 86.400 × fator de pico | [números](numbers/index.md) |
| Quantos dados? | estimativa de armazenamento | itens × tamanho × retenção × replicação | [números](numbers/index.md) |
| Quanta rede? | estimativa de banda | requisições/s × tamanho da resposta | [números](numbers/index.md) |
| Quantas requisições em andamento? | Lei de Little | L = λ × W | [filas](queueing/index.md) |
| Quão ocupado está um recurso? | lei da utilização | U = X × S | [filas](queueing/index.md) |
| Quão lento perto da saturação? | M/M/1 | R = S / (1 − ρ) | [filas](queueing/index.md) |
| Mais nós vão ajudar? | Amdahl, USL | C(N) = N / (1 + σ(N−1) + κN(N−1)) | [filas](queueing/index.md) |
| Quão lento para os usuários azarados? | percentis | p99, p99.9; 1 − (1 − q)ᴺ sob fan-out | [percentis](percentiles/index.md) |
| Com que frequência fica fora do ar? | matemática da disponibilidade | série ∏aᵢ; paralelo 1 − ∏(1 − aᵢ) | [matemática da disponibilidade](availability-math/index.md) |

## O mapa de conceitos de estimativa { #concept-map }

A estimativa não adiciona nenhuma caixa à paleta — ela coloca **números** em todas as caixas. O mapa liga cada ferramenta desta aula (azul) aos **componentes da paleta** (verde) cuja capacidade, latência ou disponibilidade ela calcula:

``` diagram
flowchart LR
    qps["QPS, armazenamento, banda<br/>fator de pico"]:::tech --> bytes["cdn · objstore"]:::comp
    qps --> sql["sql"]:::comp
    lat["números de latência<br/>RAM, SSD, rede"]:::tech --> cache["cache"]:::comp
    little["Lei de Little,<br/>lei da utilização"]:::tech --> app["app · worker<br/>threads e pools"]:::comp
    little --> queue["queue<br/>sala de espera"]:::comp
    knee["o joelho,<br/>utilização segura"]:::tech --> sql
    knee --> app
    usl["Amdahl, USL<br/>fração serial"]:::tech --> sql
    pct["percentis,<br/>cauda do fan-out"]:::tech --> search["shards do search"]:::comp
    avail["matemática da disponibilidade<br/>série e paralelo"]:::tech --> red["lb · healthcheck"]:::comp
    avail --> dep["payment · email"]:::comp
    classDef comp fill:#1e9e5a22,stroke:#1e9e5a
    classDef tech fill:#2f6fed22,stroke:#2f6fed
```

| Componente da paleta | Pergunta que responde | Conceitos | Ensinado em | Cenários |
|---|---|---|---|---|
| [`app`](../../reference/components/compute/index.md#app) · [`worker`](../../reference/components/compute/index.md#worker) | Quantas instâncias, threads e conexões? | nós = pico / (capacidade × utilização-alvo) + reservas; L = λ × W | [Números](numbers/index.md), [Filas](queueing/index.md) | `monolith`, `scale-out` |
| [`sql`](../../reference/components/storage/index.md#sql) | Um primário aguenta a carga — e os dados? | teto de escritas duráveis, U = X × S, o joelho, fração serial (linhas quentes), armazenamento × retenção × replicação | [Filas](queueing/index.md), [Números](numbers/index.md) | `monolith`, `flash-sale` |
| [`cache`](../../reference/components/storage/index.md#cache) | Quanta memória, e quantas leituras ainda chegam ao banco? | latência de RAM vs SSD vs rede, o conjunto quente, 80/20 | [Números](numbers/index.md) | `read-heavy-cache` |
| [`cdn`](../../reference/components/edge/index.md#cdn) · [`objstore`](../../reference/components/storage/index.md#objstore) | Quantos bits por segundo e quantos terabytes? | banda = QPS × tamanho, bits vs bytes, arquivos e logs dominam o armazenamento | [Números](numbers/index.md) | `cdn-static`, `video-streaming` |
| [`queue`](../../reference/components/messaging/index.md#queue) | Qual o tamanho da fila, e com que rapidez ela esvazia? | W = L / λ, taxa de admissão abaixo da capacidade | [Filas](queueing/index.md) | `flash-sale`, `async-queue` |
| [`search`](../../reference/components/compute/index.md#search) | Por que o p99 do usuário é pior que o de cada shard? | percentis a partir de histogramas, 1 − (1 − q)ᴺ, hedging, orçamentos de latência | [Percentis](percentiles/index.md) | `scale-out`, `search-autocomplete` |
| [`lb`](../../reference/components/edge/index.md#lb) · [`healthcheck`](../../reference/components/observability/index.md#healthcheck) | Quão disponível é um conjunto de réplicas, e quão rápido uma falha é detectada? | paralelo 1 − ∏(1 − aᵢ), MTTR, tempo de detecção + failover | [Matemática da Disponibilidade](availability-math/index.md) | `scale-out`, `multi-region` |
| [`payment`](../../reference/components/external/index.md#payment) · [`email`](../../reference/components/external/index.md#email) | Quanto uma dependência fraca custa ao caminho crítico? | série ∏ aᵢ, tirá-la do caminho, um segundo provedor | [Matemática da Disponibilidade](availability-math/index.md) | `payment-system`, `notification-system` |

!!! tip "Na entrevista"

    Gaste **3–5 minutos** com estimativas, logo depois de esclarecer os requisitos, e faça-as **em voz alta no quadro**: premissas numa coluna, resultados na outra. Termine sempre cada linha com sua consequência — "≈ 400 leituras/s em média, 1.200 no pico: um banco daria conta, mas um cache torna isso trivial" — e siga em frente. Se o entrevistador der números, use-os; se não, proponha números redondos e pergunte "faz sentido?". Precisão não é o objetivo; **ordens de grandeza que guiam decisões** são.

!!! success "Boas práticas"

    - **Mantenha a estimativa numa planilha versionada ao lado do código** — premissas numa coluna, resultados em outra, cada uma com data; quando um laboratório ou a produção mede um número, troque a premissa e recalcule. Na BoxOffice: `results/lab2.md` ([Hands-on 2](../../hands-on/2/index.md#measure-it)).
    - **Meça primeiro o número ao qual a conclusão é mais sensível** — aqui, os 5 ms que uma reserva ocupa o banco; um erro de 2× ali dobra o número de máquinas.
    - **Dimensione as camadas sensíveis a latência para ~60–70% de utilização no pico, mais uma de reserva (N+1)** — o joelho e a perda de um nó precisam, os dois, da folga. Na BoxOffice: o HPA do lab 10 escala o `catalog` em 60% de CPU.
    - **Escreva a fórmula ao lado de cada configuração de capacidade** — `maximum-pool-size: 10  # 1.000 reservas/s × 10 ms = 10`; o próximo engenheiro pode reconferir quando a carga mudar. Na BoxOffice: `DB_POOL_SIZE` no compose do lab 1, variado no lab 2.
    - **Compare a estimativa com a realidade depois de cada grande evento** — requisições/s, p99 e utilização previstos contra observados; a diferença diz qual premissa corrigir antes da próxima abertura de vendas.

!!! warning "Armadilhas comuns"

    - **Estimar a média e projetar para ela**: sistemas falham no pico. Sempre aplique um fator de pico e, para negócios movidos a eventos como a BoxOffice, estime o pico repentino separadamente.
    - **Falsa precisão**: "1.157,4 req/s" mostra que você perdeu o ponto. Diga "cerca de 1.000".
    - **Esquecer replicação e índices** nas estimativas de armazenamento (×3 para réplicas, muitas vezes ×1,5–2 para índices e overhead).
    - **Misturar bits e bytes**: links de rede são medidos em bits por segundo (Gbit/s), armazenamento em bytes (GB). 1 GB/s = 8 Gbit/s.
    - **Números sem conclusão**: uma estimativa que não muda o design não era necessária.

---

## Relacionados { #related }

- Laboratório: [2. Meça primeiro](../../hands-on/2/index.md) — testes k6 de smoke, carga e estresse no `catalog`; encontre o joelho e confira a Lei de Little.
- Exercício: [Estimativas](../../exercises/estimation/index.md) — uma planilha de estimativas para cinco sistemas.
- Aula: [15. Engenharia de desempenho](../performance/index.md) — testes de carga e planejamento de capacidade com a mesma matemática.
- Referência: [Folha de números](../../reference/numbers/index.md) e a [referência rápida para entrevistas](../../support/interview/quick-reference/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Decisões de design mudam em **ordens de grandeza**; a estimativa diz de que lado de um limiar você está.
    - Cinco passos: **decisão → premissas → potências de dez → conferência de sanidade → conclusão**.
    - A capacidade é aproximadamente **vagas paralelas / tempo de serviço**, e você roda bem **abaixo** dela (≈ 60–75%) porque a latência explode perto da saturação.
    - O resultado mais importante de uma estimativa costuma ser **qual número medir** em seguida.
    - Percentis e matemática da disponibilidade dizem o que os **usuários** experimentam, não só o que os servidores fazem.

## O que quebra em seguida { #what-breaks-next }

O veredito é uma **diferença de 30×**: ~33.000 tentativas de reserva/s contra ~1.100 que um banco sustenta com uma utilização sensata, e o laboratório 2 mostra que uma única instância do `catalog` sai da meta de latência com algumas centenas de requisições por segundo. Uma sala de espera molda a demanda, mas ela, as réplicas da aplicação na frente do banco e um standby para o primário (uma máquina não promete 99,95%) significam **mais de uma máquina**. Entre máquinas há uma rede que perde, atrasa e duplica mensagens: um fã cuja "reserva" estoura o timeout e é repetida pode acabar com duas reservas, ou duas cobranças. O que muda quando a BoxOffice vira máquinas que só cooperam por mensagens é a [aula 3 — Sistemas Distribuídos](../distributed/index.md).

---

[^1]: XU, A. *System Design Interview — An Insider's Guide*, vol. 1. Byte Code LLC, 2020. Chapter 2 (back-of-the-envelope estimation).
