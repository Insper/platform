"O `inventory` está lento no teste da pré-venda." Em dez minutos, o canal do time tem quatro propostas: colocar um cache Redis, mudar para uma instância de banco maior, adicionar mais pods, reescrever o caminho quente em Go. Cada uma custa dias ou dólares; no máximo uma ataca a causa real; e ninguém olhou uma única métrica ainda. Uma **metodologia** é o que substitui esse chute: uma forma sistemática de ir de um sintoma ao recurso limitante, e de lá à única mudança que importa.

---

## Anti-métodos: como não fazer { #anti-methods-how-not-to-do-it }

Brendan Gregg cataloga as abordagens que parecem produtivas e não são[^1]:

| Anti-método | Como se parece | Por que falha |
|---|---|---|
| **Poste de luz** (*streetlight*) | Olhar as ferramentas que você conhece (`top`, o dashboard padrão) porque são fáceis, não porque o problema está ali | Você encontra o que é visível, não o que está errado |
| **Mudança aleatória** | Ajustar flags da JVM, tamanhos de pool e número de réplicas até "parecer mais rápido" | As mudanças interagem; melhorias são ruído; regressões ficam escondidas |
| **Culpar outra pessoa** | "É o banco." "É a rede." | Move o problema sem evidência; o outro time repete o ciclo |
| **Checklist improvisado** | Rodar o checklist do último incidente | Só funciona quando o problema se repete exatamente |

A alternativa é o **método científico**[^5]: fazer uma pergunta ("por que o p99 de `POST /holds` é 2 s a 1 500 req/s?"), formular uma **hipótese** ("o pool de conexões está esgotado"), fazer uma **previsão** ("pendentes no pool > 0 e tempo de espera ≈ o aumento de latência"), **testá-la** com uma medição e só então mudar algo — uma coisa — e medir de novo.

---

## Caracterização da carga: que carga, exatamente? { #workload-characterization-what-load-exactly }

Um teste é tão bom quanto seu modelo da carga. A caracterização da carga responde a quatro perguntas[^1]:

| Pergunta | Significado | Resposta do BoxOffice |
|---|---|---|
| **Quem** está causando a carga? | Clientes, bots, jobs internos, regiões | Fãs no celular (70 %) e na web, a API de revendedores parceiros, bots de cambistas (bloqueados no [WAF](../../../reference/components/edge/index.md#waf)) |
| **Por que** a carga acontece? | Fluxos de usuário e eventos de negócio | Navegação nos dias normais; uma venda às 10:00 cria uma corrida sincronizada |
| **O que** é a carga? | Mix de endpoints, tamanhos de payload, razão leitura/escrita, dados acessados | 80 % leituras (página do evento, mapa de assentos, busca), 20 % escritas (reservas, pedidos) durante a venda |
| **Como** ela muda no tempo? | Padrão de chegada, picos, sazonalidade | Onda diária suave; venda = rampa quase vertical às 10:00:00, pico nos primeiros 5 minutos, cauda longa |

### Dos logs a um modelo de carga { #workload-model }

Os logs de acesso de produção (ou as métricas do gateway) são a fonte da verdade. Uma consulta sobre uma venda passada dá o mix e a taxa de chegada:

```sql title="workload.sql — endpoint mix of the last on-sale (gateway access logs in the warehouse)"
SELECT route,
       count(*)                                         AS requests,
       round(100.0 * count(*) / sum(count(*)) OVER (), 1) AS pct,
       max(per_second)                                  AS peak_rps
FROM (
  SELECT route, date_trunc('second', ts) AS sec, count(*) OVER (PARTITION BY route, date_trunc('second', ts)) AS per_second
  FROM gateway_access_log
  WHERE ts BETWEEN '2026-09-12 09:55' AND '2026-09-12 10:30'
) t
GROUP BY route
ORDER BY requests DESC;
```

O resultado vira o modelo de carga que todos os testes desta aula reutilizam (os números são premissas ilustrativas para uma venda de estádio):

| Endpoint | Fatia das requisições | Pico req/s | SLO de latência (p99) | Observações |
|---|---|---|---|---|
| `GET /events/{id}` (página do evento) | 35 % | 10 500 | 200 ms | Cacheável; CDN + Redis |
| `GET /events/{id}/seats` (mapa de assentos) | 30 % | 9 000 | 300 ms | Muda a cada segundo durante a venda |
| `GET /search` | 10 % | 3 000 | 400 ms | Serviço de busca |
| `POST /holds` (reservar assentos) | 15 % | 4 500 | 300 ms | Fortemente consistente; locks de linha |
| `POST /orders` (checkout) | 7 % | 2 100 | 800 ms | Chama o provedor de pagamento |
| `GET /orders/{id}` | 3 % | 900 | 200 ms | Polling da confirmação |

Três propriedades das cargas reais são perdidas rotineiramente nos testes e precisam ser modeladas de propósito:

- **Assimetria** (*skew*). As requisições não são uniformes sobre os dados. Durante uma venda, um evento recebe quase todo o tráfego, e os melhores setores recebem a maioria das reservas — o clássico problema de **chave quente / linha quente**. A popularidade costuma ser modelada com uma distribuição de Zipf.
- **Sessões e think time.** Um fã olha o mapa de assentos por alguns segundos antes de reservar. O **think time** (a pausa entre as requisições de um usuário) molda a concorrência: com a mesma taxa de chegada, think times mais longos significam mais sessões simultâneas (Lei de Little de novo).
- **Chegadas sincronizadas.** Vendas reais não são uma rampa suave: centenas de milhares de clientes atualizam a página às 10:00:00. Um teste que sobe a carga em 10 minutos perde o segundo mais perigoso do dia.

---

## O método USE: um checklist para cada recurso { #the-use-method-a-checklist-for-every-resource }

O **método USE** diz: *para cada recurso, verifique Utilização, Saturação e Erros*[^2]. Sua força é a completude — ele faz você olhar recursos que esqueceria — e a rapidez: alguns minutos de verificação estreitam a busca para um recurso.

- **Utilização** — quão ocupado o recurso está (porcentagem do tempo ou da capacidade).
- **Saturação** — quanto trabalho extra está na fila esperando por ele.
- **Erros** — eventos de erro (alocações que falham, pacotes descartados, timeouts).

Recursos não são só hardware. Em um serviço Java, os **recursos de software** — pools, locks, filas — saturam com mais frequência do que a CPU:

| Recurso | Utilização | Saturação | Erros | Onde ler |
|---|---|---|---|---|
| **CPU** | `%usr + %sys` por núcleo | Fila de execução (coluna `r` do `vmstat` > número de núcleos); **throttling** do container | — | `mpstat -P ALL 1`, `vmstat 1`, `cpu.stat` do cgroup (`nr_throttled`) |
| **Memória** | Usada vs limite | Swap, varredura de páginas; GC rodando com mais frequência | `OOMKilled`, `OutOfMemoryError` | `free -m`, `vmstat` (`si/so`), logs de GC da JVM / JFR |
| **Rede** | Vazão vs capacidade do link | Backlog de sockets, retransmissões | Descartes, resets | `sar -n DEV,TCP,ETCP 1`, `ss -s`, `nstat` |
| **Disco** | `%util` | Tamanho médio da fila (`aqu-sz`), await | Erros de I/O | `iostat -xz 1` |
| **Pool de threads** (Tomcat) | Threads ocupadas / máximo | Fila de accept / requisições esperando | Requisições rejeitadas | `tomcat_threads_busy_threads`, `..._config_max_threads` (Micrometer) |
| **Pool de conexões** (HikariCP) | Ativas / máximo | **Threads pendentes** esperando uma conexão | Timeouts de conexão | `hikaricp_connections_active`, `..._pending`, `..._timeout_total` |
| **Banco de dados** | CPU, I/O do host do banco | Sessões esperando (`wait_event`), esperas por lock | Deadlocks, timeouts de statement | `pg_stat_activity`, `pg_locks`, `pg_stat_statements` |
| **Partição Kafka / fila** | Tempo ocupado do consumidor | **Atraso do consumidor** (*lag*) | Mensagens na DLQ | Exporter de consumer lag, métricas do broker |

### Um passo a passo: por que `POST /holds` está lento? { #a-walk-through-why-is-post-holds-slow }

Durante um teste de pré-venda a 1 500 reservas/s, o p99 de `POST /holds` é 2,1 s (SLO: 300 ms). Seguindo o USE, de cima para baixo:

``` diagram-sim
flowchart TD
    s["Sintoma: p99 de POST /holds = 2,1 s a 1 500 req/s"] --> cpu{"CPU do inventory?"}
    cpu -->|"U 45 %, fila de execução baixa,<br/>sem throttling"| mem{"Memória / GC?"}
    mem -->|"GC < 2 % do tempo"| tp{"Threads do Tomcat?"}
    tp -->|"200 / 200 ocupadas — saturado,<br/>mas ocupadas fazendo o quê?"| pool{"Pool Hikari?"}
    pool -->|"10 / 10 ativas,<br/>180 threads pendentes"| db{"PostgreSQL?"}
    db -->|"CPU 35 %, mas sessões em<br/>wait_event = Lock: tuple"| root["Gargalo: contenção de locks de linha em assentos quentes,<br/>mantidos durante toda a transação"]
```

1. **CPU do `inventory`**: 45 % de utilização, fila de execução curta, sem throttling. Não é o gargalo — adicionar pods não ajudaria.
2. **Memória/GC**: o GC usa menos de 2 % do tempo. Tudo bem.
3. **Threads do Tomcat**: todas as 200 ocupadas. Saturado — mas threads são um recurso *sintoma*: estão ocupadas *esperando* alguma coisa.
4. **Pool de conexões**: 10 de 10 conexões ativas, **180 threads pendentes**. Toda reserva espera uma conexão: pela Lei de Little, 180 esperando / 1 500 por segundo ≈ 120 ms de espera no pool em média, e muito mais na cauda.
5. **PostgreSQL**: CPU só a 35 % — então uma instância maior também não ajudaria. Mas o `pg_stat_activity` mostra a maioria das sessões em `wait_event = Lock: tuple`: transações esperam por **locks de linha** nos mesmos poucos assentos quentes, e cada transação mantém seu lock enquanto também chama o serviço de preços.

O gargalo é **contenção de locks**, amplificada por transações longas. Das quatro propostas da introdução, nenhuma resolveria: um cache não ajuda escritas, um banco maior já tem CPU ociosa, mais pods adicionariam mais gente esperando, e Go esperaria nos mesmos locks. As correções que funcionam — transações mais curtas (chamar o serviço de preços *antes* do `BEGIN`), `SELECT … FOR UPDATE SKIP LOCKED` para entregar aos fãs assentos livres *diferentes* e uma sala de espera para limitar as reservas concorrentes — são discutidas em [Encontrando gargalos](../bottlenecks/index.md) e [Bancos de dados — transações](../../databases/transactions/index.md).

```sql title="Who is waiting on what? (PostgreSQL)"
SELECT wait_event_type, wait_event, state, count(*)
FROM pg_stat_activity
WHERE datname = 'boxoffice'
GROUP BY 1, 2, 3
ORDER BY count(*) DESC;
```

!!! example "No código do BoxOffice: USE em dois recursos de software (lab 2)"

    O [Hands-on 2 — Medir primeiro](../../../hands-on/2/index.md) observa o `catalog` por dentro com três medidores do Actuator, uma linha por segundo, ao lado do k6 e do `docker stats`: threads ocupadas do Tomcat (utilização do pool de threads), conexões ativas e requisições **pendentes** (utilização e saturação do pool HikariCP). Na execução do lab a 600 req/s a linha mostra 200 threads ocupadas, 9 conexões ativas e **190 pendentes**: a mesma cadeia do passo a passo acima — as threads estão saturadas porque esperam pelas 10 conexões, então mais threads só acrescentariam gente esperando.

    ``` { .bash title="scripts/watch-metrics.sh (USE from the inside, once per second)" }
    --8<-- "docs/2027.1/hands-on/2/code/scripts/watch-metrics.sh"
    ```

---

## RED e os sinais de ouro: a visão do serviço { #red-and-the-golden-signals-the-service-view }

O USE olha os **recursos** por dentro. O **método RED** olha cada **serviço** por fora, do jeito que os usuários o experimentam[^3]:

- **Rate** (taxa) — requisições por segundo;
- **Errors** (erros) — requisições com falha por segundo (ou como fração);
- **Duration** (duração) — a distribuição de latência (histogramas → percentis).

Os quatro **sinais de ouro** do Google — latência, tráfego, erros, saturação — são a mesma ideia mais a saturação[^4]. Use os dois juntos: **o RED diz *qual serviço* está infeliz; o USE diz *qual recurso* dentro dele é a causa.** Em um teste de carga, as métricas RED de cada serviço são os thresholds; as métricas USE são o que você inspeciona quando um threshold falha. A [aula de Observabilidade](../../observability/signals/index.md) mostra como coletar ambos com OpenTelemetry.

---

## Paridade do ambiente de teste { #test-environment-parity }

Um teste de carga mede *o ambiente em que roda*. Cada diferença em relação à produção é um motivo para o resultado não se transferir:

| Dimensão | Precisa ser igual à produção? | Observação do BoxOffice |
|---|---|---|
| Tipos de instância, arquitetura de CPU, requests/limits dos containers | **Sim** | Um teste em nós ARM diz pouco sobre uma produção x86, e vice-versa |
| Número de réplicas e configuração de autoscaling | Sim, ou escale o teste proporcionalmente *e verifique a linearidade* | Reduzir 10× só vale onde o sistema escala linearmente — bancos e locks raramente escalam |
| Configuração: tamanhos de pool, timeouts, flags da JVM, feature flags | **Sim** | Mesmos valores Helm / overlay Kustomize da produção, vindos do Git |
| Volume e distribuição dos dados | **Mesma ordem de grandeza**, mesma assimetria | 1 000 assentos em vez de 60 000 mudam todos os índices e todas as taxas de acerto de cache |
| Caminho de rede: CDN, WAF, gateway, TLS, service mesh | Sim, para testes de sistema | Handshakes TLS e o gateway acrescentam CPU e latência |
| Dependências (provedor de pagamento, e-mail) | **Simuladas com comportamento realista** | Um mock que responde em 1 ms esconde os 300 ms do provedor real; use o sandbox do provedor ou um mock com latência injetada (Toxiproxy, WireMock) |
| Agentes de observabilidade | Sim | O agente OpenTelemetry tem custo; meça com ele ligado |

Como a infraestrutura é código ([Entrega](../../cloud-native/delivery/index.md)), a opção mais confiável é um **ambiente de desempenho efêmero**: criado a partir dos mesmos módulos Terraform/OpenTofu e manifests da produção durante a campanha de testes, carregado com um conjunto de dados sintéticos do tamanho da produção e destruído depois.

!!! example "No código do BoxOffice: um ambiente pequeno, idêntico em toda execução (lab 11)"

    O gate de desempenho do [Hands-on 11](../../../hands-on/11/performance-gate/index.md) não pode ter paridade com a produção — roda num runner compartilhado da CI —, então escolhe **paridade entre execuções**: seu próprio arquivo Compose sobe PostgreSQL, Redis e `catalog` com o mesmo limite de CPU (1 CPU) do `docker-compose.yaml`, porque os orçamentos são por réplica; e o healthcheck de prontidão mais o `docker compose … up --wait` garantem que o k6 nunca meça uma JVM que ainda está subindo. O preço: os números dizem se *esta mudança* deixou o `catalog` mais lento, não quantos fãs a produção aguenta.

    ``` { .yaml title=".github/ci/compose.perf.yaml (the service under test)" }
    --8<-- "docs/2027.1/hands-on/11/code/.github/ci/compose.perf.yaml:27:54"
    ```

---

## Dados de teste { #test-data }

- **Volume**: mesma ordem de grandeza da produção — os tamanhos das tabelas determinam a profundidade dos índices, a escolha dos planos e se o conjunto de trabalho cabe na memória.
- **Distribuição**: reproduza a assimetria (um evento quente, setores populares) — senão você perde a contenção de locks e as partições quentes, e superestima os misses de cache na cauda longa.
- **Unicidade**: se todo usuário virtual entra com a mesma conta ou reserva o mesmo assento, você testa um ponto quente artificial; se toda requisição pede um evento aleatório *diferente*, você testa um cache frio artificial. Parametrize a partir de arquivos de dados realistas.
- **Reset de estado**: reservas e pedidos mudam os dados. Restaure um snapshot do banco antes de cada execução para que as execuções sejam comparáveis.
- **Privacidade**: nunca copie dados pessoais de produção para um ambiente de teste; gere dados sintéticos com a mesma forma estatística.

```javascript title="k6: parameterized users and a skewed choice of events"
import { SharedArray } from 'k6/data';

const users  = new SharedArray('users',  () => JSON.parse(open('./data/users.json')));    // 50 000 synthetic fans
const events = new SharedArray('events', () => JSON.parse(open('./data/events.json')));   // sorted by popularity

// Zipf-like choice: low indexes (popular events) are chosen much more often
export function pickEvent() {
  const u = Math.random();
  return events[Math.floor(events.length * Math.pow(u, 3))];
}

export function pickUser() {
  return users[Math.floor(Math.random() * users.length)];
}
```

---

## Aquecimento: meça o regime permanente — e teste o frio { #warm-up }

Logo depois de um deploy, um serviço JVM é mais lento do que será em cinco minutos: classes estão carregando, o compilador JIT ainda não compilou os métodos quentes, os pools de conexão estão enchendo, o Redis e o cache de buffers do PostgreSQL estão frios e o autoscaler está no mínimo. Medir esse período mistura duas perguntas diferentes.

- **Testes de regime permanente** (load, soak, breakpoint) devem **aquecer primeiro** e excluir o aquecimento dos thresholds.
- **Testes de partida a frio** medem deliberadamente o sistema frio, porque a produção também tem momentos frios: um deploy durante o tráfego, um cache esvaziado, um failover para uma réplica fria, novos pods adicionados pelo autoscaler durante o pico.

```javascript title="k6: a warm-up scenario excluded from the thresholds"
export const options = {
  scenarios: {
    warmup: {
      executor: 'constant-arrival-rate', rate: 200, timeUnit: '1s',
      duration: '3m', preAllocatedVUs: 100, exec: 'browse',
    },
    measure: {
      executor: 'constant-arrival-rate', rate: 1000, timeUnit: '1s',
      duration: '15m', preAllocatedVUs: 500, maxVUs: 2000,
      startTime: '3m', exec: 'browse',
    },
  },
  thresholds: {
    // only the 'measure' scenario counts towards pass/fail
    'http_req_duration{scenario:measure}': ['p(99)<300'],
    'http_req_failed{scenario:measure}': ['rate<0.001'],
  },
};
```

---

## Ruído e repetibilidade { #noise-and-repeatability }

Ambientes de nuvem são ruidosos: vizinhos compartilham hosts, redes variam, autoscalers tomam caminhos diferentes. Uma execução é uma anedota.

- **Repita** cada configuração pelo menos três vezes e reporte a mediana e a dispersão; uma diferença menor que a dispersão entre execuções não é um resultado.
- **Verifique o gerador de carga**: CPU abaixo de ~70 %, rede não saturada, VUs suficientes alocados (o k6 avisa quando um cenário de taxa de chegada fica sem VUs: `dropped_iterations`). Para testes grandes, rode o k6 distribuído (k6-operator no Kubernetes ou um serviço na nuvem).
- **Mesmas condições**: mesmo snapshot de dados, mesma janela de horário, mesmas versões; registre-as no relatório.
- **Longo o suficiente**: um teste de 2 minutos não revela um vazamento de conexões, o crescimento de arquivos de log ou um vazamento de memória — esse é o trabalho do [teste soak](../load-testing/index.md#soak-test).

!!! example "Um plano de teste de uma página para a venda"

    - **Objetivo**: `POST /holds` p99 < 300 ms, erros < 0,1 %; `GET /events/{id}` p99 < 200 ms — a 45 000 req/s no total, o pico esperado de 30 000 req/s × 1,5.
    - **Carga**: o mix de endpoints acima; eventos com assimetria de Zipf; 50 000 usuários sintéticos; think time de 2–8 s dentro das sessões.
    - **Modelo**: aberto (taxa de chegada); uma rampa de 0 → pico em 30 s para reproduzir as 10:00:00.
    - **Ambiente**: ambiente efêmero `perf` a partir dos módulos de produção; banco restaurado de um snapshot com 60 000 assentos; mock de pagamento a 300 ms ± 100 ms.
    - **Testes**: smoke → load (pico, 20 min) → spike → breakpoint → soak (4 h na média diária).
    - **Observar**: RED por serviço; USE nos nós, pools e PostgreSQL; traces das requisições lentas; perfis do `inventory`.
    - **Saída**: thresholds aprovados em 3 execuções consecutivas, folga ≥ 30 % no joelho.

!!! tip "Na entrevista"

    Perguntas do tipo "encontre o gargalo" recompensam estrutura. Diga o método em voz alta: "Eu começaria pelas métricas RED, voltadas ao usuário, para achar o serviço lento, depois aplicaria o USE aos seus recursos — incluindo os de software: pool de threads, pool de conexões, locks — e só mudaria o recurso que está saturado." Mencionar que **CPU a 45 % com um pool de conexões saturado significa que mais pods não vão ajudar** é exatamente o tipo de insight que os entrevistadores procuram.

!!! success "Boas práticas"

    - **Escreva um plano de teste de uma página antes da primeira execução, e revise-o como um design doc** — objetivo, carga, modelo, ambiente, observação e critérios de saída combinados antes impedem a campanha de virar uma busca por uma execução verde (exemplo acima).
    - **Tire a mistura de endpoints dos logs de produção, e atualize-a depois de cada grande evento** — a mistura muda a cada funcionalidade; um modelo da venda do ano passado testa o produto do ano passado.
    - **Transforme o checklist USE num script e rode-o ao lado do gerador de carga** — uma linha por segundo com os medidores do pool de threads e do pool de conexões transforma "o que está saturado?" numa leitura, não num palpite. No BoxOffice: o `scripts/watch-metrics.sh` do [lab 2](../../../hands-on/2/index.md).
    - **Defina o ambiente de teste como código, com os limites de produção por réplica** — mesmos limites de CPU e memória, mesmos tamanhos de pool e timeouts, para que um número por réplica signifique o mesmo no teste e na produção. No BoxOffice: o `.github/ci/compose.perf.yaml` do [lab 11](../../../hands-on/11/performance-gate/index.md).
    - **Repita cada configuração pelo menos três vezes e relate a mediana e a dispersão** — uma diferença menor que a dispersão entre execuções é ruído, não melhoria.

!!! warning "Armadilhas"

    - **Parar no primeiro recurso saturado**: pools de threads geralmente estão saturados *porque* algo mais adiante está lento; siga a espera.
    - **Dados aleatórios uniformes**: escondem linhas quentes e exageram os misses de cache.
    - **Mocks que respondem instantaneamente**: a latência real da dependência segura threads e conexões.
    - **Incluir o aquecimento no resultado de regime permanente** — ou nunca testar partidas a frio.
    - **Reduzir o ambiente e extrapolar os resultados linearmente**: contenção e coerência (USL) tornam isso errado.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    SYM["symptom:<br/>POST /holds is slow"] --> RED["RED per service<br/>→ Observability signals"]
    RED --> USE["USE per resource: CPU,<br/>thread pool, connection pool, locks"]
    USE --> BOT["the saturated resource"]
    BOT --> FIX["change ONE thing<br/>→ Bottlenecks"]
    LOGS["gateway access logs<br/>in the warehouse"] --> WL["workload model:<br/>mix, arrival rate"]
    WL --> TEST["load test<br/>→ Load testing"]
    ENV["environment parity,<br/>test data, warm-up"] --> TEST
    NOISE["repeat runs,<br/>check the load generator"] --> TEST
    TEST --> SYM
```

**Componentes da paleta:** [`metrics`](../../../reference/components/observability/index.md#metrics) e [`tracing`](../../../reference/components/observability/index.md#tracing) (RED para serviços, USE para recursos) · [`logs`](../../../reference/components/observability/index.md#logs), [`apigw`](../../../reference/components/edge/index.md#apigw) e [`dwh`](../../../reference/components/storage/index.md#dwh) (logs de acesso transformados em modelo de carga) · [`app`](../../../reference/components/compute/index.md#app) (pools de threads, CPU) · [`sql`](../../../reference/components/storage/index.md#sql) (pool de conexões, locks) · [`cache`](../../../reference/components/storage/index.md#cache) (quente vs frio) · [`waf`](../../../reference/components/edge/index.md#waf) (bots que não fazem parte da carga). **Cenários:** `monolith` (perfil breakpoint), `observability-stack`. **Continua em:** [Observabilidade — sinais](../../observability/signals/index.md), [Testes de carga](../load-testing/index.md), [Encontrando gargalos](../bottlenecks/index.md), [Bancos de dados — transações](../../databases/transactions/index.md), [Cloud-native — entrega](../../cloud-native/delivery/index.md) (ambientes de desempenho efêmeros).

---

[^1]: GREGG, B. *Systems Performance: Enterprise and the Cloud*. 2nd ed. Addison-Wesley, 2020. Cap. 2 "Methodologies".
[^2]: GREGG, B. [The USE Method](https://www.brendangregg.com/usemethod.html){target="_blank"}.
[^3]: WILKIE, T. [The RED Method: How to Instrument Your Services](https://grafana.com/blog/2018/08/02/the-red-method-how-to-instrument-your-services/){target="_blank"}. Grafana Labs, 2018.
[^4]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/monitoring-distributed-systems/){target="_blank"}, cap. 6 "Monitoring Distributed Systems". O'Reilly, 2016.
[^5]: JAIN, R. *The Art of Computer Systems Performance Analysis*. Wiley, 1991.
