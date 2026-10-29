!!! abstract "Neste lab"

    - Escrever testes de **carga**, de **estresse** e de **varredura** para o `catalog` com o k6, usando um **modelo de carga aberto**.
    - Encontrar o **joelho**: a taxa de chegada em que a latência deixa de ser plana e explode.
    - Verificar a **Lei de Little** com números tirados de *dentro* do serviço (threads ocupadas, conexões com o banco) e identificar o **gargalo**.
    - Mudar uma coisa (o pool de conexões) e **medir de novo**: o gargalo mudou de lugar?

"Meça primeiro" é o hábito mais útil em design de sistemas. Antes de acrescentar um cache, uma réplica ou mais dez servidores, você precisa saber **quanta carga o sistema atual aguenta, onde ele quebra e por quê**. Chutar é como times passam um mês construindo um cache para um serviço cujo limite real era um pool de 10 conexões. Neste lab você trata o `catalog` como uma caixa-preta, com um gerador de carga na frente (o k6) e alguns medidores dentro (o Actuator), e produz o gráfico mais importante da disciplina: **latência contra throughput**.

## Antes de começar { #before-you-start }

| | |
|---|---|
| **Tempo** | 2–3 horas (cada varredura leva ~10 minutos de espera: inicie-a e leia a próxima seção) |
| **Você precisa de** | as ferramentas do lab 0 (k6, uv, jq); Docker com pelo menos **4 GB**; feche aplicações pesadas enquanto mede |
| **Diretório** | todo comando roda na raiz do seu repositório `boxoffice/` (Windows: dentro do WSL 2) |

``` { .bash .copy }
docker compose version        # Docker Compose v2.x (or newer)
java -version                 # 21 or newer
mvn -v                        # Apache Maven 3.9+
k6 version                    # k6 v1.0+
uv --version                  # uv (runs the Python helper scripts)
```

**Estado inicial** — o fim do lab 1, com a stack rodando (`docker compose up -d`, `catalog` saudável):

``` { .tree title="boxoffice/ at the start of lab 2" }
boxoffice/
    docker-compose.yaml        # db + catalog (port 8082)
    load/hello.js  load/smoke.js
    results/lab0.md  results/lab1.md
    scripts/check-env.sh
    services/catalog/          # the service of lab 1
```

!!! tip "Recupere o atraso"

    Pulou ou quebrou o lab 1? Baixe [boxoffice-after-lab-1.zip](../1/boxoffice-after-lab-1.zip), descompacte, `cd boxoffice` e rode `docker compose up --build -d`. Este lab só **acrescenta** arquivos (scripts do k6 e auxiliares); todos aparecem completos abaixo e estão em [`code/`](code/load/load.js).

## Slides

<div class="slides-embed">
  <iframe src="slides/measure.html" title="Slides: hands-on 2 — meça primeiro" loading="lazy" allowfullscreen></iframe>
</div>

Clique nos slides e use ← → para navegar; **F** abre em tela cheia e **P** abre a visão do apresentador, com as notas.
[:material-presentation: Abrir os slides em uma nova aba](slides/measure.html){:target="_blank"}

!!! info "Conexão com a teoria"

    - Na [história da disciplina](../../index.md#story), este lab fecha o capítulo 2 e abre o capítulo 3: ele troca o tempo de serviço *suposto* na [verificação de capacidade](../../classes/estimation/index.md) da aula por um joelho *medido*, e mostra que uma instância sai da meta de latência com algumas centenas de requisições por segundo — longe da demanda da abertura de vendas; por isso o BoxOffice precisa de [mais máquinas](../../classes/distributed/index.md).
    - Aula 2, [Estimativas](../../classes/estimation/index.md): [filas e Lei de Little](../../classes/estimation/queueing/index.md), [percentis e latência de cauda](../../classes/estimation/percentiles/index.md).
    - Aula 15, [Engenharia de desempenho](../../classes/performance/index.md): [tipos de teste de carga](../../classes/performance/load-testing/index.md), [encontrando gargalos](../../classes/performance/bottlenecks/index.md).

## Antes de medir: uma hipótese { #before-you-measure-a-hypothesis }

O playground roda o mesmo experimento em segundos. Forme uma hipótese primeiro e depois confira-a contra o serviço real.

**Experimente:** o cenário `monolith` abaixo começa com o perfil *breakpoint* — a carga cresce até algo ceder. Observe qual componente fica vermelho primeiro e como o p99 se comporta logo antes. Depois anote o seu palpite para o `catalog`: *"ele vai quebrar em cerca de ___ req/s porque ___ satura primeiro"*.

<div class="sdp" data-scenario="monolith" data-mode="compact" data-profile="breakpoint" data-height="480"></div>

## 1. Modelo de carga fechado ou aberto? { #1-closed-or-open-workload }

No lab 0, cada usuário virtual (VU) mandava uma requisição, esperava a resposta e mandava a próxima. Esse é um modelo **fechado**: quando o servidor fica lento, o gerador de carga fica lento junto, e o teste educadamente para de pressionar. Fãs reais não esperam uns pelos outros: às 10:00 eles chegam na taxa em que chegam. Esse é um modelo **aberto**.

| | Modelo fechado (`vus`, `constant-vus`) | Modelo aberto (`constant-arrival-rate`, `ramping-arrival-rate`) |
|---|---|---|
| Você define | o número de usuários simultâneos | a **taxa de chegada** (requisições por segundo) |
| Quando o servidor fica lento | o k6 manda menos requisições | o k6 mantém a taxa e inicia mais VUs |
| Bom para | "N usuários trabalhando num back office" | sites públicos, APIs, vendas relâmpago |
| Esconde a sobrecarga? | **sim** — o throughput cai em silêncio (*coordinated omission*) | não — latência e fila crescem à vista |
| Sinal de saturação | latência sobe, throughput fica plano | a latência explode, **`dropped_iterations`** > 0 |

!!! warning "Coordinated omission"

    Um testador de modelo fechado que espera respostas lentas *omite* as requisições que teria mandado nesse meio-tempo — justamente as que sofreriam a pior latência. O resultado parece melhor que a realidade. Prefira executores por taxa de chegada quando a pergunta é "aguentamos X requisições por segundo?"[^1].

## 2. Os scripts { #2-the-scripts }

O **teste de carga** mantém uma taxa de chegada constante (`RATE`) por um tempo fixo, com uma mistura realista: 80% de detalhes de evento e 20% de listagens por cidade.

``` { .javascript title="load/load.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/load/load.js"
```

O **teste de estresse** sobe uma escada de taxas além do joelho, segura o pico e depois volta a uma taxa baixa. A pergunta não é só "onde quebra?", mas "**ele se recupera sozinho** quando a carga vai embora?".

``` { .javascript title="load/stress.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/load/stress.js"
```

| Teste | Executor | Pergunta |
|---|---|---|
| smoke (`load/smoke.js`, lab 1) | 1 VU | funciona, e quão rápido sem carga? |
| carga (`load/load.js`) | `constant-arrival-rate` | a X req/s, quais são o p50/p95/p99 e a taxa de erros? |
| varredura (`scripts/sweep.sh`) | várias execuções de `load.js` | onde está o joelho? |
| estresse (`load/stress.js`) | `ramping-arrival-rate` | o que acontece além do joelho, e ele se recupera? |

## 3. Observe por dentro { #3-watch-from-the-inside }

O k6 vê o serviço de fora. Para descobrir *por que* a latência cresce, você precisa de medidores de dentro. O Spring Boot Actuator já os publica:

| Métrica | Significado | Limite |
|---|---|---|
| `tomcat.threads.busy` | requisições sendo processadas agora | `server.tomcat.threads.max` = 200 |
| `hikaricp.connections.active` | conexões com o banco em uso | tamanho do pool (`DB_POOL_SIZE`, padrão **10**) |
| `hikaricp.connections.pending` | requisições **esperando** uma conexão | — (deveria ser 0) |

``` { .bash title="scripts/watch-metrics.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/scripts/watch-metrics.sh"
```

Mantenha três terminais abertos durante todo teste: o k6, `bash scripts/watch-metrics.sh` e `docker stats` (CPU do `catalog` e do `db`).

Você deve ver uma linha por segundo. Em repouso, `busy_threads` vale 1 (a requisição que lê a métrica); sob carga ela segue a Lei de Little, e na sobrecarga o pool enche (linhas de uma execução deste lab, a 50, 400 e 600 req/s):

``` { .text }
time      busy_threads  db_active  db_pending
03:43:21           1.0        0.0         0.0
03:45:19          12.0       10.0         3.0
03:46:15         200.0        9.0       190.0
```

## 4. Encontre o joelho { #4-find-the-knee }

Rode o `load.js` com taxas crescentes, um minuto cada, e salve cada resumo. O script de varredura cuida da contabilidade (e faz um aquecimento antes: uma JVM fria estragaria o primeiro ponto):

``` { .bash title="scripts/sweep.sh" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/scripts/sweep.sh"
```

``` { .python title="scripts/summarize.py" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/2/code/scripts/summarize.py"
```

``` { .bash .copy }
docker compose up -d                       # catalog + db from lab 1
bash scripts/sweep.sh 50 100 200 300 400 500 600
uv run scripts/summarize.py results/lab2/rate-*.json
```

O `sweep.sh` imprime uma linha por etapa (`>>> warm-up: 30 s at RATE=50 (not recorded)`, depois `>>> RATE=50 req/s for 1m`, …) e leva cerca de 10 minutos para sete taxas. Em seguida, o `summarize.py` imprime uma tabela Markdown como a de baixo — cole-a em `results/lab2.md`.

Uma execução de exemplo num notebook (catalog limitado a 1 CPU, pool de 10 conexões):

| oferecido (req/s) | throughput (req/s) | p50 (ms) | p95 (ms) | p99 (ms) | p99 detalhe | p99 listagem | erros | descartadas | máx. VUs |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 50 | 50 | 1,3 | 29,2 | 41,3 | 6,5 | 89,7 | 0,0% | 0 | 50 |
| 100 | 100 | 0,6 | 23,6 | 32,9 | 3,9 | 41,4 | 0,0% | 0 | 100 |
| 200 | 200 | 0,5 | 21,9 | 33,5 | 5,5 | 59,3 | 0,0% | 0 | 200 |
| 300 | 300 | 0,6 | 24,9 | 38,6 | 8,5 | 59,0 | 0,0% | 0 | 300 |
| 400 | 400 | 1,5 | 49,6 | 223,7 | 199,1 | 294,4 | 0,0% | 0 | 400 |
| 500 | 490 | 15,0 | 982,5 | 2.056,2 | 1.984,9 | 2.238,8 | 0,0% | 410 | 556 |

Acima de 500 req/s os números pulam de uma execução para outra — sinal de que o serviço está sobrecarregado e são as filas que decidem o resultado, não o código.

```python exec="1" html="1"
--8<-- "docs/2027.1/hands-on/2/knee.py"
```

Como ler:

- **Abaixo do joelho**, o throughput é igual à taxa oferecida e o p99 é praticamente plano: as requisições raramente esperam umas pelas outras.
- **No joelho**, um recurso chega a ~100% de ocupação. Pequenos aumentos de carga produzem aumentos **grandes** de latência — a curva de filas da aula 2 (`W ≈ S / (1 − ρ)`).
- **Além do joelho**, o throughput deixa de acompanhar a taxa oferecida, aparece `dropped_iterations` (o k6 ficou sem VUs para manter a taxa) e o p99 é medido em **segundos**. Os usuários já foram embora.

!!! tip "Capacidade é o joelho, não o máximo"

    A capacidade útil desta instância é a maior taxa **com o p99 dentro da meta** (digamos, 300 ms), não o maior throughput que o resumo já imprimiu. Planeje com uma margem de segurança abaixo do joelho: o próximo pico não vai pedir licença.

## 5. Verificação da Lei de Little { #5-littles-law-check }

A Lei de Little vale para qualquer sistema estável[^2]: **L = λ × W** — o número médio de requisições dentro (`L`) é igual à taxa de chegada (`λ`) vezes o tempo médio que cada uma passa dentro (`W`). Aplique-a a duas fronteiras:

1. **O serviço inteiro**: `L` deve bater com `tomcat.threads.busy`. A 300 req/s com latência média de 10 ms, `L = 300 × 0.010 = 3` threads ocupadas.
2. **O pool do banco**: cada requisição segura uma conexão durante o seu tempo de banco. O pool é um servidor com **10 vagas**, então ele satura quando `λ × (database time per request) = 10`.

Essa segunda linha prevê o joelho. Meça o tempo de banco por requisição com um usuário (lab 1): se a mistura dá em média ~8 ms de banco por requisição *sem carga*, o pool permitiria `10 / 0.008 ≈ 1,250 req/s`. O joelho que você mediu é bem mais baixo — porque sob carga as consultas ficam mais lentas (o banco e a única CPU do catalog também estão ocupados), e cada requisição segura sua conexão por mais tempo. Olhe o `watch-metrics.sh` perto do joelho: `db_active` fica em **10** e `db_pending` começa a crescer. O pool está cheio; as requisições fazem fila por ele.

??? question "Pense antes: as threads ocupadas chegam a 200 e `db_pending` a 190 a 600 req/s. O que isso significa?"

    O Tomcat tem 200 threads, todas ocupadas; 10 seguram uma conexão com o banco e **190 estão esperando por uma**. Ao serviço não faltam threads nem CPU na camada web — faltam conexões com o banco (ou velocidade do banco). Acrescentar threads ao Tomcat só acrescentaria gente esperando. Este é o exercício de "encontrar o cano mais estreito" da disciplina: o gargalo é o recurso cuja fila cresce.

## 6. Mude o gargalo de lugar { #6-move-the-bottleneck }

Mude uma variável e meça de novo. O tamanho do pool é configurável sem rebuild (`DB_POOL_SIZE`, ligado no lab 1):

``` { .bash .copy }
DB_POOL_SIZE=30 docker compose up -d catalog        # recreate catalog with a bigger pool
OUT=results/lab2-pool30 bash scripts/sweep.sh 50 100 200 300 400 500 600
uv run scripts/summarize.py results/lab2-pool30/rate-*.json
```

Compare as duas tabelas. Em geral o joelho **sobe**, mas não para sempre: com 30 conexões, o próximo recurso satura — a única CPU do `catalog` ou o próprio PostgreSQL (observe o `docker stats`). Um pool maior também tem custo: cada conexão é um processo no PostgreSQL, e no lab 6 três serviços × três réplicas × 30 conexões passariam de `max_connections`. Otimizar um recurso sempre muda o gargalo de lugar; o trabalho é saber para onde ele foi.

## 7. Estresse: além do joelho e de volta { #7-stress-past-the-knee-and-back }

``` { .bash .copy }
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=results/lab2-stress.html \
  k6 run -e PEAK=600 load/stress.js
```

Abra [http://localhost:5665](http://localhost:5665){target="_blank"} enquanto ele roda: o dashboard web do k6 plota a taxa de requisições, os percentis de latência e os VUs ao longo do tempo; o relatório HTML é salvo no fim. Procure três momentos:

1. **O joelho** na subida: o p95 sai do chão.
2. **O pico**: os VUs sobem em direção a `maxVUs` — o k6 precisa de mais usuários simultâneos para manter a taxa porque cada requisição demora mais (a Lei de Little de novo, do lado do cliente).
3. **A recuperação**: depois da queda para 25% do pico, quantos segundos até o p95 voltar ao normal? Um serviço que se recupera sozinho é *estável*; um que continua lento (filas que nunca esvaziam, um coletor de lixo que nunca alcança) precisa de load shedding — tema dos labs 3 e 9.

## Meça { #measure-it }

Registre tudo em `results/lab2.md`:

``` { .markdown title="results/lab2.md" .copy }
# Lab 2 — catalog under load

Setup: catalog 1 CPU / 768 MB, Hikari pool = 10, PostgreSQL 17, k6 open model (80% detail, 20% list)

## Sweep (pool = 10)
<paste the table printed by summarize.py>

## Sweep (pool = 30)
<paste the table>

## Knee and capacity
- Knee (pool 10): ____ req/s — capacity with p99 < 300 ms: ____ req/s
- Knee (pool 30): ____ req/s — capacity with p99 < 300 ms: ____ req/s
- Bottleneck at the knee (evidence from watch-metrics / docker stats): ____

## Little's Law
| Offered (req/s) | avg latency (s) | λ × W | busy threads (measured) | db_active (measured) |
|---:|---:|---:|---:|---:|
|  100 |  |  |  |  |
|  300 |  |  |  |  |

## Stress test
- Peak reached: ____ req/s; p95 at the peak: ____ ms; dropped iterations: ____
- Recovery time after the drop: ____ s

## Hypothesis check
- My playground hypothesis was: ____ . It was right / wrong because ____ .
```

!!! note "Se os seus números forem diferentes"

    O seu joelho não vai estar em 300–400 req/s: ele depende da sua CPU, dos recursos do Docker e do que mais está rodando. O que importa é o **formato** (plano, depois uma subida brusca), a **evidência** do gargalo (`db_active` cravado no tamanho do pool, `db_pending` crescendo) e a **mudança** quando você redimensiona o pool. Se o joelho for muito baixo (< 100 req/s), olhe o `docker stats` durante a varredura: um container travado no limite de CPU, ou uso de swap, explica. Se o k6 imprimir `Insufficient VUs`, o serviço passou do joelho — isso é um resultado, não um erro.

## Solução de problemas { #troubleshooting }

| Sintoma | Causa | Correção |
|---|---|---|
| toda requisição falha com `connection refused` | a stack não está rodando, ou `BASE_URL` aponta para outro lugar | `docker compose ps`; no lab 2 o alvo é `http://localhost:8082` (o padrão) |
| `WARN Insufficient VUs, reached 200 active VUs` | a taxa de chegada precisa de mais requisições simultâneas que `maxVUs` | esperado além do joelho; a execução continua válida — anote `dropped_iterations` |
| `summarize.py` imprime só o cabeçalho | nenhum JSON casou com o glob (pasta `OUT` errada) | `ls results/lab2/`; passe a mesma pasta que você deu ao `sweep.sh` |
| `watch-metrics.sh` imprime `?` | falta o `jq`, ou o `catalog` não responde na 8082 | instale o `jq`; `curl localhost:8082/actuator/metrics` precisa listar `tomcat.threads.busy` |
| `uv: command not found` | uv não instalado | lab 0, passo 1 — ou rode `python3 scripts/summarize.py …` (ele só usa a biblioteca padrão) |
| o primeiro ponto de uma varredura é pior que os seguintes | JVM fria | o `sweep.sh` já faz aquecimento; repita a execução se a sua máquina estava ocupada |
| os números variam muito entre duas execuções idênticas | carga de fundo (navegador, IDE, outros containers) | feche o que puder, pare containers não relacionados (`docker ps`), rode duas vezes e fique com a segunda |

!!! success "Boas práticas neste lab"

    - **Teste carga com um modelo aberto** — `load/load.js` usa `constant-arrival-rate`, então um serviço lento não consegue baixar em silêncio a carga que recebe ([Percentis — medindo com honestidade](../../classes/estimation/percentiles/index.md)).
    - **Aqueça, depois varra, com uma pausa entre as etapas** — `scripts/sweep.sh` descarta um aquecimento de 30 s e dorme 10 s entre as taxas, para que uma JVM fria ou uma fila remanescente não estrague um ponto ([Filas — o joelho](../../classes/estimation/queueing/index.md)).
    - **Observe o lado de dentro enquanto carrega o lado de fora** — `scripts/watch-metrics.sh` imprime as threads ocupadas e as conexões pendentes, a evidência que dá nome ao gargalo ([Lei de Little](../../classes/estimation/queueing/index.md)).
    - **Mude uma variável e meça de novo** — só `DB_POOL_SIZE` muda entre as duas varreduras ([Estimativas — o método](../../classes/estimation/index.md)).
    - **Declare a capacidade como a maior taxa dentro da meta de latência** — não o maior throughput já impresso; `results/lab2.md` registra o joelho e a capacidade ([Percentis](../../classes/estimation/percentiles/index.md)).

## Limpeza { #clean-up }

``` { .bash .copy }
docker compose up -d catalog     # if you changed DB_POOL_SIZE, recreate catalog with the default (10)
docker compose down              # when you are done for the day (data is kept)
```

Guarde `results/lab2*` (os resumos JSON e o seu `results/lab2.md`): o lab 3 compara com eles. O relatório HTML é ignorado pelo Git de propósito (é grande).

## Entrega { #deliverable }

- [ ] `load/load.js`, `load/stress.js`, `scripts/sweep.sh`, `scripts/summarize.py` e `scripts/watch-metrics.sh` no seu repositório.
- [ ] Duas varreduras (pool 10 e pool 30) com as tabelas em `results/lab2.md`, o joelho e a capacidade de cada uma.
- [ ] A tabela da Lei de Little com pelo menos duas taxas, comparada com os medidores.
- [ ] O relatório HTML do teste de estresse (`results/lab2-stress.html`, sem commit) e os seus três momentos descritos.
- [ ] Um parágrafo: **qual é o gargalo do `catalog`, e qual é a sua evidência?**
- [ ] Repositório com a tag `lab2`; [quiz](quiz.md) respondido.

## Estado final { #end-state }

``` { .tree title="added in lab 2" }
boxoffice/
    load/load.js                 # open-model load test (RATE, DURATION, LIST_SHARE)
    load/stress.js               # staircase past the knee and back
    scripts/sweep.sh             # one load.js run per rate
    scripts/summarize.py         # k6 summaries -> Markdown table (uv run)
    scripts/watch-metrics.sh     # Tomcat threads and Hikari pool, once per second
    results/lab2/  results/lab2-pool30/  results/lab2.md
```

Nenhum serviço mudou: a stack ainda é `db` + `catalog`.

Próximo: [Lab 3 — Borda](../3/index.md), em que uma réplica vira três.

[^1]: Documentação do Grafana k6, [Open and closed models](https://grafana.com/docs/k6/latest/using-k6/scenarios/concepts/open-vs-closed/){target="_blank"} e [Arrival-rate executors](https://grafana.com/docs/k6/latest/using-k6/scenarios/executors/){target="_blank"}.
[^2]: John D. C. Little, "A Proof for the Queuing Formula: L = λW", *Operations Research* 9(3), 1961.
