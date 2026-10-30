Até aqui o seu sistema "funciona". O Marco 6 faz uma pergunta mais difícil: **ele cumpre os SLOs na meta de teste, por tempo suficiente, todas as vezes — e o que quebra primeiro além dela?** Uma *campanha* de testes de carga responde do jeito que um time de performance responderia: um plano escrito, um modelo de carga realista, uma sequência de tipos de teste, repetições, verificações de correção depois de cada execução e um registro de hipóteses e correções até que os números se sustentem.

!!! abstract "Metas"

    Com este marco o seu time vai:

    - **Planejar** uma campanha a partir dos SLOs da meta de teste da sua [opção de sistema](../index.md#system-options): jornadas de usuário, mistura, taxas de chegada, dados e ambiente.
    - **Modelar** a carga com um modelo aberto e thresholds por jornada no k6.
    - **Executar** testes de smoke, load (×3), stress, spike, soak e breakpoint e lê-los com dashboards.
    - **Encontrar** o joelho e o gargalo, e **melhorar** o sistema em iterações documentadas.
    - **Garantir** a correção (nenhuma venda duplicada, nenhuma mensagem perdida) e **automatizar** um portão de desempenho no CI.

Este marco se apoia no exercício [relatório de teste de carga](../../load-test-report/index.md), na [Aula 15 — Performance](../../../classes/performance/index.md) e na stack de observabilidade do [Lab 8](../../../hands-on/8/index.md). Entrega na **semana 16**, peso de **15%** do projeto.

## O que entregar { #what-to-deliver }

- Um **plano da campanha** (antes de executar qualquer coisa) na documentação, seguindo o [template](#templates).
- Scripts k6 em `load/`, o script de carga de dados, os resultados brutos (`load/results/`, um resumo JSON por execução), capturas de tela dos dashboards.
- Um **relatório da campanha**: resultados por teste, veredito dos SLOs, joelho, gargalo, registro de iterações, verificações de correção.
- Um job de **portão de desempenho** no workflow de CI ([Lab 11](../../../hands-on/11/index.md)).
- A tag `m6` no commit com tudo isso.

## Critérios de aceitação { #acceptance-criteria }

- [ ] **(obrigatório)** Plano escrito e versionado **antes** da primeira execução de carga (o histórico de commits mostra isso).
- [ ] **(obrigatório)** Na **meta de teste** da sua opção, todos os SLOs se mantêm por **≥ 10 minutos** de regime em **3 repetições** (ou, se ela não for alcançável, o gargalo está provado e uma nova meta foi combinada com o professor antes da semana 14).
- [ ] Modelo de carga com **pelo menos 3 jornadas de usuário**, uma mistura em % e executores de **modelo aberto** (`constant-arrival-rate` / `ramping-arrival-rate`).
- [ ] Thresholds por jornada (tags) que codificam os SLOs; o k6 termina com código diferente de zero quando um SLO falha.
- [ ] Smoke, load ×3, stress até **2× a meta**, spike, soak de **≥ 30 minutos** e breakpoint executados; resultados brutos versionados.
- [ ] Joelho identificado (vazão vs p99) e o **gargalo** nomeado com evidências (dashboards, USE, Lei de Little).
- [ ] **≥ 2 iterações de melhoria** documentadas com números de antes/depois sob a mesma carga.
- [ ] Uma **verificação de correção** depois de cada execução (por exemplo, 0 vendas duplicadas) com a sua saída.
- [ ] Um **portão de desempenho** no CI: uma execução smoke do k6 com thresholds que reprova o pipeline em caso de regressão.
- [ ] Seção *Uso de IA* (veja a [política](../../index.md#use-of-ai-tools)).

## Passo a passo { #step-by-step }

### 1. Escreva o plano primeiro { #1-write-the-plan-first }

Um plano obriga o time a combinar o que é "sucesso" **antes** que os números tentem você a mudar a meta. Parta da tabela de SLOs da sua opção; transforme cada SLO em um threshold do k6; defina as jornadas e a parcela de tráfego de cada uma a partir das estimativas do M1; decida onde os testes rodam (Docker Compose ou Kubernetes, qual máquina, quais recursos) e quais dados são carregados.

``` diagram
flowchart LR
    plan["Plano<br/>SLOs → thresholds<br/>jornadas, mistura, dados"] --> smoke["Smoke<br/>o script funciona"]
    smoke --> load["Load ×3<br/>meta, ≥ 10 min"]
    load --> stress["Stress<br/>até 2× a meta"]
    stress --> spike["Spike"]
    spike --> soak["Soak<br/>≥ 30 min"]
    soak --> bp["Breakpoint"]
    bp --> analyse["Análise<br/>joelho, gargalo"]
    analyse -->|"hipótese → mudança"| load
```

### 2. Modele a carga { #2-model-the-workload }

Usuários reais não batem em um único endpoint: um fã da BoxOffice navega, entra na sala de espera, reserva assentos e (às vezes) paga. Um cenário k6 por jornada, cada um com sua própria taxa de chegada, mantém a mistura exata e permite um threshold por jornada[^1].

```javascript title="load/boxoffice.js"
import http from 'k6/http';
import { check } from 'k6';

const BASE = __ENV.BASE_URL || 'http://localhost:8080';
const TYPE = __ENV.TEST_TYPE || 'load';
const BROWSE = Number(__ENV.BROWSE_RATE || 1000); // catalog reads/s at the test target
const HOLD = Number(__ENV.HOLD_RATE || 100);      // seat holds/s at the test target
const EVENTS = Number(__ENV.EVENTS || 1000);
const TOKEN = __ENV.TOKEN || '';

const JSON_HEADERS = { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` };
// 409 (seat already taken) and 429 (waiting room full) are business outcomes, not failures
const BUSINESS = http.expectedStatuses({ min: 200, max: 299 }, 409, 429);

function profile(rate) {
  const r = (f) => Math.max(1, Math.round(rate * f));
  const base = { timeUnit: '1s', preAllocatedVUs: Math.max(10, r(0.2)), maxVUs: Math.max(100, r(3)) };
  switch (TYPE) {
    case 'smoke':
      return { ...base, executor: 'constant-arrival-rate', rate: 1, duration: '1m' };
    case 'stress': {
      const stages = [];
      for (const f of [0.5, 1, 1.25, 1.5, 1.75, 2]) {
        stages.push({ target: r(f), duration: '30s' }, { target: r(f), duration: '2m' });
      }
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.1), stages };
    }
    case 'spike':
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.2), stages: [
        { target: r(0.2), duration: '2m' }, { target: r(3), duration: '10s' },
        { target: r(3), duration: '2m' }, { target: r(0.2), duration: '10s' },
        { target: r(0.2), duration: '3m' } ] };
    case 'soak':
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.1), stages: [
        { target: r(1), duration: '2m' }, { target: r(1), duration: '30m' } ] };
    case 'breakpoint':
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.1), stages: [
        { target: r(4), duration: '20m' } ] };
    default: // load
      return { ...base, executor: 'ramping-arrival-rate', startRate: r(0.1), stages: [
        { target: r(1), duration: '2m' }, { target: r(1), duration: '10m' }, { target: 0, duration: '30s' } ] };
  }
}

export const options = {
  scenarios: {
    browse: { ...profile(BROWSE), exec: 'browse' },          // 1. browse the catalog
    queue: { ...profile(HOLD * 2), exec: 'joinQueue' },      // 2. join the waiting room
    hold: { ...profile(HOLD * 0.3), exec: 'holdAndLeave' },  // 3. hold and abandon (hold expires)
    purchase: { ...profile(HOLD * 0.7), exec: 'purchase' },  // 4. hold and pay
  },
  thresholds: {
    'http_req_duration{name:catalog}': ['p(99)<200'],
    'http_req_duration{name:hold}': ['p(99)<500'],
    'http_req_failed{scenario:browse}': ['rate<0.001'],
    'http_req_failed{scenario:purchase}': ['rate<0.001'],
    checks: ['rate>0.99'],
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max'],
};

const eventId = () => 1 + Math.floor(Math.random() * EVENTS);

export function browse() {
  const res = http.get(`${BASE}/events/${eventId()}`, { tags: { name: 'catalog' } });
  check(res, { 'catalog 200': (r) => r.status === 200 });
}

export function joinQueue() {
  const res = http.post(`${BASE}/queue/${eventId()}`, null,
    { headers: JSON_HEADERS, tags: { name: 'queue' }, responseCallback: BUSINESS });
  check(res, { 'queue accepted or full': (r) => r.status === 200 || r.status === 202 || r.status === 429 });
}

function hold() {
  const body = JSON.stringify({ eventId: eventId(), quantity: 1 + Math.floor(Math.random() * 4) });
  return http.post(`${BASE}/holds`, body,
    { headers: JSON_HEADERS, tags: { name: 'hold' }, responseCallback: BUSINESS });
}

export function holdAndLeave() {
  const res = hold();
  check(res, { 'hold created or seat taken': (r) => r.status === 201 || r.status === 409 });
}

export function purchase() {
  const res = hold();
  if (res.status !== 201) {
    return; // seat taken: the fan tries again later
  }
  const pay = http.post(`${BASE}/orders`, JSON.stringify({ holdId: res.json('id') }),
    { headers: JSON_HEADERS, tags: { name: 'pay' } });
  check(pay, { 'order created': (r) => r.status === 201 });
}
```

Adapte URLs, corpos e autenticação à sua API (obtenha um token no `setup()` ou desligue a autenticação em um profile de teste dedicado — e diga isso). Nas outras opções as jornadas mudam (chat: conectar, enviar, ler histórico; corridas: atualizações de localização, busca de próximos, pedir corrida; feed: ler timeline, postar, curtir; vídeo: pedir manifesto/segmentos, upload; assistente: perguntar, perguntar com chamada de ferramenta), mas a estrutura é a mesma.

??? example "Assistente de suporte com IA: TTFT com um LLM simulado"

    Faça o teste de carga do assistente contra um **LLM simulado** (um pequeno servidor HTTP que transmite tokens com uma distribuição de latência fixa), para medir o *seu* sistema e não o provedor do modelo. Em um endpoint com streaming, o tempo até a chegada do primeiro byte é uma boa aproximação do tempo até o primeiro token:

    ```javascript title="load/assistant.js (excerpt)"
    import http from 'k6/http';
    import { Trend } from 'k6/metrics';

    const ttft = new Trend('ttft', true);

    export const options = { thresholds: { ttft: ['p(95)<2000'] } };

    export default function () {
      const body = JSON.stringify({ question: 'Can I change the name on my ticket?' });
      const res = http.post(`${__ENV.BASE_URL}/assistant/chat`, body,
        { headers: { 'Content-Type': 'application/json' }, tags: { name: 'chat' } });
      ttft.add(res.timings.waiting); // time to first byte of the streamed answer
    }
    ```

    Meça o modelo real separadamente, a uma taxa baixa (por exemplo, 1 requisição/s), e informe os dois.

### 3. Carregue os dados e fixe o ambiente { #3-seed-the-data-and-fix-the-environment }

Toda execução começa do **mesmo estado**: os mesmos eventos, assentos e usuários, uma sala de espera vazia (ou conhecida), caches esvaziados ou aquecidos do mesmo jeito. Escreva isso como um script (`load/seed.sh`) e execute-o antes de cada teste. Fixe os recursos (`cpus`/`mem_limit` no Compose, requests/limits no Kubernetes, mín/máx do HPA) e registre-os no plano.

### 4. Execute a sequência { #4-run-the-sequence }

```bash title="load/campaign.sh"
#!/usr/bin/env bash
# usage: ./load/campaign.sh <test-type> <run-number>   e.g. ./load/campaign.sh load 2
set -euo pipefail
TYPE=${1:-smoke}; RUN=${2:-1}
STAMP=$(date +%Y%m%d-%H%M%S)
mkdir -p load/results
./load/seed.sh
k6 run -e TEST_TYPE="$TYPE" -e BASE_URL="${BASE_URL:-http://localhost:8080}" \
  --summary-export "load/results/${TYPE}-run${RUN}-${STAMP}.json" \
  load/boxoffice.js | tee "load/results/${TYPE}-run${RUN}-${STAMP}.txt"
psql "${CHECK_DB_URL:?set CHECK_DB_URL}" -f load/correctness.sql \
  | tee "load/results/${TYPE}-run${RUN}-${STAMP}-correctness.txt"
```

Enquanto cada teste roda, acompanhe o dashboard RED (taxa, erros, duração por serviço) e os sinais de saturação (CPU, uso do pool, atraso do consumidor, réplicas do HPA) no Grafana. Faça capturas de tela no regime e no joelho; anote os horários de qualquer coisa estranha.

| Teste | O que responde | Critério de aprovação |
|-|-|-|
| Smoke | O script, os dados e o sistema funcionam? | 0 erros |
| Load ×3 | Os SLOs são cumpridos na meta, de forma repetível? | Todos os thresholds passam nas 3 execuções |
| Stress (até 2×) | Onde está o joelho? O que satura primeiro? | Joelho localizado; degradação graciosa (sem queda) |
| Spike | O sistema absorve um ×3 repentino (sala de espera, autoscaling)? | Erros limitados; tempo de recuperação medido |
| Soak (≥ 30 min) | Vazamentos, crescimento lento (memória, conexões, atraso, disco)? | Nenhuma tendência de alta em latência ou recursos |
| Breakpoint | Qual é o máximo antes de falhar? | Taxa de ruptura informada |

### 5. Verifique a correção depois de cada execução { #5-check-correctness-after-every-run }

Um sistema rápido que vende o mesmo assento duas vezes falhou. Depois de **toda** execução, rode uma consulta de correção e guarde a saída.

```sql title="load/correctness.sql"
-- BoxOffice: a seat may belong to at most one active hold or sold order
SELECT event_id, seat_id, count(*) AS owners
  FROM seat_allocations
 WHERE status IN ('HELD', 'SOLD')
 GROUP BY event_id, seat_id
HAVING count(*) > 1;

-- every paid order has exactly its seats marked SOLD
SELECT o.id
  FROM orders o
  LEFT JOIN seat_allocations s ON s.order_id = o.id AND s.status = 'SOLD'
 WHERE o.status = 'PAID'
 GROUP BY o.id, o.quantity
HAVING count(s.seat_id) <> o.quantity;
```

| Opção | Verificação de correção |
|-|-|
| Venda relâmpago BoxOffice | 0 vendas duplicadas; assentos vendidos = assentos dos pedidos pagos |
| Chat em tempo real | Nenhum buraco nos números de sequência por conversa das mensagens confirmadas |
| Despacho de corridas | Nenhum motorista em duas corridas ativas |
| Feed social | Seguidores amostrados veem o post dentro do SLO; contadores consistentes |
| Plataforma de vídeo | Todo upload confirmado tem todas as resoluções ou um job com falha e motivo |
| Assistente de suporte com IA | 0 ações inseguras de ferramentas; toda chamada de ferramenta registrada com a identidade do usuário |

### 6. Itere: hipótese → mudança → resultado { #6-iterate-hypothesis-change-result }

Quando um teste falhar (ou para deslocar o joelho), escreva a **hipótese primeiro**, com um número: "o pool do inventário (10 conexões) se esgota em ~400 reservas/s porque L = λ × W = 400 × 0,025 = 10". Mude **uma** coisa, repita o mesmo teste e registre o resultado — confirmada ou refutada. No mínimo duas iterações documentadas; cada uma é uma pequena história com evidências.

### 7. Coloque um portão de desempenho no CI { #7-gate-performance-in-ci }

Um teste smoke com thresholds no pipeline pega regressões (um índice que sumiu, uma consulta N+1) antes que elas cheguem à campanha. Acrescente um job ao workflow do [Lab 11](../../../hands-on/11/index.md):

```yaml title=".github/workflows/ci.yaml (excerpt)"
  performance-gate:
    runs-on: ubuntu-latest
    needs: build
    steps:
      - uses: actions/checkout@v4
      - name: Start the system
        run: docker compose up -d --wait
      - name: Seed test data
        run: ./load/seed.sh
      - uses: grafana/setup-k6-action@v1
      - name: k6 smoke with SLO thresholds (fails the job on regression)
        run: k6 run -e TEST_TYPE=smoke -e BASE_URL=http://localhost:8080 load/boxoffice.js
```

O runner é pequeno e compartilhado, então o portão usa **taxas de smoke** e thresholds folgados; ele detecta regressões, não capacidade.

## Templates

=== "English"

    ~~~markdown
    # Load-test campaign — <team / system>

    ## 1. Plan (committed before the first run)
    ### Objectives (test-target SLOs)
    | SLI | Journey | Threshold | k6 threshold |
    |-|-|-|-|
    | p99 latency | browse | < 200 ms | `http_req_duration{name:catalog}: p(99)<200` |

    ### Workload model
    | Journey | Steps | Share | Arrival rate at target |
    |-|-|-|-|
    | browse | GET event | ...% | ... /s |

    ### Data and environment
    Seeded data (volumes); environment (Compose/K8s, machine, resources, HPA); where k6 runs.

    ### Entry and exit criteria
    Entry: smoke passes, dashboards up, data seeded. Exit: 3 load runs pass, or bottleneck proven.

    ## 2. Results
    | Test | Run | Rate | p50 | p95 | p99 | Errors | Thresholds | Correctness |
    |-|-|-|-|-|-|-|-|-|
    | load | 1 | | | | | | pass/fail | 0 violations |

    Charts: throughput vs p99 (knee), spike timeline, soak trends. Dashboard screenshots.

    ## 3. Bottleneck
    Resource, evidence (USE, Little's Law), why it saturates first.

    ## 4. Iteration log
    | # | Hypothesis (with numbers) | Change | Before | After | Verdict |
    |-|-|-|-|-|-|
    | 1 | | | | | confirmed / refuted |
    | 2 | | | | | |

    ## 5. Verdict
    At the test target, the SLOs hold / do not hold because ... Capacity statement: ...

    ## 6. Performance gate
    Link to the workflow run; thresholds used.

    ## 7. AI usage
    ~~~

=== "Português"

    ~~~markdown
    # Campanha de testes de carga — <time / sistema>

    ## 1. Plano (versionado antes da primeira execução)
    ### Objetivos (SLOs da meta de teste)
    | SLI | Jornada | Limite | Threshold do k6 |
    |-|-|-|-|
    | latência p99 | navegar | < 200 ms | `http_req_duration{name:catalog}: p(99)<200` |

    ### Modelo de carga
    | Jornada | Passos | Parcela | Taxa de chegada na meta |
    |-|-|-|-|
    | navegar | GET evento | ...% | ... /s |

    ### Dados e ambiente
    Dados carregados (volumes); ambiente (Compose/K8s, máquina, recursos, HPA); onde o k6 roda.

    ### Critérios de entrada e saída
    Entrada: smoke passa, dashboards no ar, dados carregados. Saída: 3 execuções de load passam, ou gargalo provado.

    ## 2. Resultados
    | Teste | Execução | Taxa | p50 | p95 | p99 | Erros | Thresholds | Correção |
    |-|-|-|-|-|-|-|-|-|
    | load | 1 | | | | | | passou/falhou | 0 violações |

    Gráficos: vazão vs p99 (joelho), linha do tempo do spike, tendências do soak. Capturas dos dashboards.

    ## 3. Gargalo
    Recurso, evidência (USE, Lei de Little), por que satura primeiro.

    ## 4. Registro de iterações
    | # | Hipótese (com números) | Mudança | Antes | Depois | Veredito |
    |-|-|-|-|-|-|
    | 1 | | | | | confirmada / refutada |
    | 2 | | | | | |

    ## 5. Veredito
    Na meta de teste, os SLOs se mantêm / não se mantêm porque ... Declaração de capacidade: ...

    ## 6. Portão de desempenho
    Link para a execução do workflow; thresholds usados.

    ## 7. Uso de IA
    ~~~

## Rubrica { #rubric }

Níveis conforme definidos em [Como os exercícios são avaliados](../../index.md#how-the-exercises-are-graded).

| Critério | I | D | C | B | A |
|-|-|-|-|-|-|
| Plano **(obrigatório)** | Nenhum | Escrito depois das execuções, ou faltam SLOs | SLOs, jornadas, mistura, dados, ambiente, critérios de entrada/saída | Mistura e taxas derivadas das estimativas do M1 | Riscos do próprio teste (limites do gerador, dados) planejados |
| Veredito dos SLOs **(obrigatório)** | Sem execuções de load | Menos de 3 execuções, ou < 10 min de regime | SLOs cumpridos na meta em 3 execuções (ou gargalo provado e meta combinada) | Dispersão entre execuções informada e explicada | Margem acima da meta quantificada (por exemplo, aguenta 1,3×) |
| Carga e scripts | Um endpoint, modelo fechado | Modelo aberto, mas sem thresholds por jornada | ≥ 3 jornadas, modelo aberto, thresholds por jornada | Resultados de negócio (409/429) tratados corretamente | Tempo de pensamento, sessões ou concentração de dados modelados e justificados |
| Sequência de testes | — | Faltam tipos | Os seis tipos com resultados brutos | Cada tipo interpretado (joelho, recuperação, tendências, taxa de ruptura) | Soak ou spike revela e corrige um problema real |
| Gargalo e iterações | Chute | Uma iteração ou sem antes/depois | ≥ 2 iterações com antes/depois | Hipóteses quantificadas antes da mudança | Próximo gargalo previsto e confirmado |
| Correção e portão no CI | — | Correção não verificada | Verificação depois de cada execução + portão no CI rodando | O portão pegou (ou pegaria) uma regressão demonstrada | Correção verificada sob spike e falhas, não só em regime |

## FAQ

??? question "Nossa máquina não alcança a meta de teste. E agora?"

    Isso é um resultado, se você provar: mostre o gargalo (muitas vezes o gerador de carga ou a CPU do notebook, não o serviço), o joelho e as evidências. Depois combine uma nova meta com o professor **antes da semana 14** — não na véspera da entrega.

??? question "A campanha deve rodar no Docker Compose ou no Kubernetes?"

    No ambiente que vocês vão apresentar, de preferência o Kubernetes (M5) com o HPA ativo, já que o autoscaling faz parte de como o sistema cumpre os SLOs. Se rodar no Compose, diga por quê e mantenha os recursos fixos.

??? question "Uma das três execuções de load falhou. Podemos descartá-la?"

    Não. Informe todas as execuções. Investigue a que falhou (ruído, uma pausa de GC, um cache frio, um atraso do autoscaling); se corrigir a causa, repita as três.

??? question "Respostas 409 e 429 contam como erro?"

    Não quando são o comportamento projetado (assento ocupado, sala de espera cheia). Marque-as como esperadas no k6 (`responseCallback`) e informe-as separadamente: uma sala de espera que rejeita 90% dos fãs está "correta", mas merece uma frase no relatório.

??? question "Quanto tempo leva a campanha inteira?"

    Faça a conta: 3 × 13 min de load, ~15 min de stress, ~8 min de spike, 32 min de soak, ~20 min de breakpoint — cerca de duas horas de execuções, mais análise e iterações. Comece cedo no marco.

??? question "A IA pode escrever o script k6?"

    Pode fazer um rascunho — declare o uso. Vocês precisam saber explicar cada cenário, taxa e threshold, e por que o modelo é aberto. Os resultados, como sempre, precisam vir das suas próprias execuções.

[^1]: Documentação do Grafana k6, "Scenarios" e "Thresholds" (tags e thresholds por cenário), [grafana.com/docs/k6](https://grafana.com/docs/k6/latest/using-k6/scenarios/){target="_blank"}.
