O teste que não previu a queda do ano passado usava 200 usuários virtuais, cada um em um laço "requisição, espera a resposta, dorme um segundo". Ele reportou p95 = 180 ms. No dia real, o p99 passou de 10 segundos. Os dois números foram *medidos*; só um descrevia a realidade. A diferença não estava na ferramenta — estava em como o teste gerava carga, no que media e no que perguntava. Esta página trata de projetar testes de carga que digam a verdade: os seis tipos clássicos de teste, o modelo de carga por trás de cada um, thresholds que codificam SLOs e os erros de medição que fazem testes mentirem.

Todos os exemplos usam o **k6** (Grafana Labs), a ferramenta de testes de carga dos labs do curso: os testes são JavaScript, o motor é Go, e ele suporta os dois modelos de carga por meio de seus *executors*[^1]. Trechos equivalentes para Gatling, Locust, JMeter, wrk2 e vegeta estão no final.

---

## Anatomia de um teste k6

Um script k6 tem uma parte de **init** (imports, dados, `options`), um `setup()` opcional que roda uma vez, o **código do VU** (a função default ou uma função nomeada por cenário) que roda muitas vezes, e um `teardown()` opcional. Os testes do BoxOffice compartilham um módulo com os fluxos de usuário, então cada tipo de teste abaixo é só uma *forma de carga* diferente sobre o mesmo comportamento:

```javascript title="k6/lib/boxoffice.js"
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter } from 'k6/metrics';
import { pickEvent, pickUser } from './data.js';

export const BASE = __ENV.BASE_URL || 'http://localhost:8080';

// A 409 (seat already taken) is a valid business outcome, not a failed request.
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 399 }, 409));

const holdTime = new Trend('hold_time', true);   // business metric, in ms
const seatsHeld = new Counter('seats_held');

const json = (user) => ({
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${user.token}` },
});

export function browse() {
  const ev = pickEvent();
  const res = http.get(`${BASE}/events/${ev.id}`, { tags: { name: 'GET /events/{id}' } });
  check(res, { 'event page 200': (r) => r.status === 200 });
}

export function search() {
  const res = http.get(`${BASE}/search?q=rock&city=sao-paulo`, { tags: { name: 'GET /search' } });
  check(res, { 'search 200': (r) => r.status === 200 });
}

export function hold() {
  const ev = pickEvent();
  const user = pickUser();
  const map = http.get(`${BASE}/events/${ev.id}/seats?available=true&limit=8`,
                       { tags: { name: 'GET /events/{id}/seats' } });
  if (!check(map, { 'seat map 200': (r) => r.status === 200 })) return;
  const free = map.json('seats') || [];
  if (free.length === 0) return;                       // sold out: a valid outcome
  sleep(1 + Math.random() * 3);                        // think time: the fan picks a seat
  const seat = free[Math.floor(Math.random() * free.length)];
  const res = http.post(`${BASE}/holds`, JSON.stringify({ eventId: ev.id, seatIds: [seat.id] }),
                        Object.assign(json(user), { tags: { name: 'POST /holds' } }));
  holdTime.add(res.timings.duration);
  if (res.status === 201) seatsHeld.add(1);
  check(res, { 'hold 201 or 409': (r) => r.status === 201 || r.status === 409 });
}

export function checkout() {
  const user = pickUser();
  const res = http.post(`${BASE}/orders`, JSON.stringify({ holdId: `test-${user.id}` }),
                        Object.assign(json(user), { tags: { name: 'POST /orders' } }));
  check(res, { 'order accepted': (r) => r.status === 201 || r.status === 202 });
}
```

Três detalhes deste módulo evitam os erros de relatório mais comuns:

- **A tag `name`.** Sem ela, cada URL com um id de evento diferente vira uma série de métricas separada — milhares delas — e thresholds por endpoint ficam impossíveis.
- **Status esperados.** Por padrão, o k6 conta qualquer 4xx/5xx em `http_req_failed`. Um assento esgotado (409) é comportamento correto; um 503 não é. Decida explicitamente.
- **Métricas de negócio.** `seats_held` diz se o sistema fez trabalho útil; um teste com latência perfeita e zero assentos reservados está testando uma página de erro.

---

## Modelos de carga aberto vs fechado

Esta é a decisão de projeto mais importante de um teste de carga[^2].

- Em um **modelo fechado**, uma população fixa de N usuários fica em laço: envia uma requisição, **espera a resposta**, pensa por Z segundos, repete. Uma nova requisição só é enviada quando uma anterior terminou. A vazão é uma *consequência*: pela lei do tempo de resposta interativo, $X = N / (R + Z)$.
- Em um **modelo aberto**, as requisições chegam a uma taxa λ **independente de quão rápido o sistema responde** — como fãs na internet, que não se coordenam entre si nem esperam as requisições de estranhos terminarem. Se o sistema fica lento, as requisições continuam chegando e a fila cresce.

``` mermaid-sim
sequenceDiagram
    participant C as Fechado: 1 usuário virtual
    participant S as BoxOffice (fase lenta)
    participant O as Aberto: chegadas a cada 100 ms
    C->>S: requisição 1
    O->>S: requisição A (t = 0)
    O->>S: requisição B (t = 100 ms)
    O->>S: requisição C (t = 200 ms)
    S-->>C: resposta 1 depois de 2 s
    Note over C: só agora envia a requisição 2 — a fase lenta gerou UMA amostra
    O->>S: requisições D…T continuam chegando no horário
    S-->>O: A…T respondidas com atraso — 20 amostras lentas, uma fila crescendo
```

A consequência é dramática justamente quando importa. Considere 200 usuários virtuais com 1 s de think time:

| Tempo de resposta do sistema R | Modelo fechado: vazão $N/(R+Z)$ | Modelo aberto a 182 req/s |
|---|---|---|
| 0,1 s (saudável) | 200 / 1,1 = **182 req/s** | 182 req/s |
| 0,5 s (degradando) | 200 / 1,5 = 133 req/s | 182 req/s — a fila começa a crescer |
| 2,0 s (em dificuldade) | 200 / 3,0 = **67 req/s** | 182 req/s — a fila cresce sem limite |

O teste fechado **reduziu a carga em 63 % no momento em que o sistema sofria** — um gerador de carga que recua é um presente que nenhuma venda real dá. Use o modelo que corresponde à população real:

| Use um modelo **fechado** quando… | Use um modelo **aberto** quando… |
|---|---|
| O número de clientes é fixo e cada um espera sua resposta: um job batch de parceiro com 20 workers, atendentes de call center, um pool de consumidores de tamanho fixo | Os clientes são independentes e numerosos: usuários de internet, apps móveis, webhooks, outros serviços que te chamam no próprio ritmo |
| Você quer saber "quantas sessões concorrentes conseguimos sustentar?" | Você quer saber "conseguimos sustentar esta taxa de chegada dentro do SLO?" |

### Executors do k6

| Executor | Modelo | Parâmetros | Uso típico |
|---|---|---|---|
| `shared-iterations`, `per-vu-iterations` | Fechado | iterações, VUs | Carga de dados, verificações funcionais rápidas |
| `constant-vus` | Fechado | VUs, duração | Testes smoke; populações fixas |
| `ramping-vus` | Fechado | estágios de VUs-alvo | Perguntas sobre concorrência de sessões |
| **`constant-arrival-rate`** | **Aberto** | taxa por unidade de tempo, duração, VUs pré-alocados/máximos | Testes load e soak a uma taxa-alvo |
| **`ramping-arrival-rate`** | **Aberto** | estágios de taxa-alvo | Testes load, stress, spike e breakpoint |
| `externally-controlled` | Qualquer | controlado pela API REST do k6 | Exploração interativa |

Nos executors de taxa de chegada, os VUs são só os *trabalhadores* que executam as iterações. O k6 precisa de VUs suficientes para manter o cronograma — Lei de Little de novo: **VUs necessários ≈ taxa de chegada × duração da iteração**. Uma iteração de `hold()` leva cerca de 3 s (duas requisições mais o think time); a 500 iterações/s você precisa de ~1 500 VUs. Se o k6 ficar sem VUs, não consegue iniciar as iterações no horário e as conta na métrica **`dropped_iterations`** — que precisa ser zero, senão seu teste "aberto" virou silenciosamente um teste fechado.

---

## Thresholds: SLOs como critérios de aprovação

Um threshold transforma uma métrica em um veredito; o k6 termina com código diferente de zero quando um falha, e é isso que permite a um pipeline usá-lo como gate. Escreva os SLOs do [modelo de carga](../methodology/index.md#workload-model) como thresholds, **por endpoint**:

| SLO (do documento de design) | Threshold do k6 |
|---|---|
| Página do evento: 99 % das requisições abaixo de 200 ms | `'http_req_duration{name:GET /events/{id}}': ['p(99)<200']` |
| Reservas: 99 % abaixo de 300 ms | `'http_req_duration{name:POST /holds}': ['p(99)<300']` |
| Menos de 0,1 % de requisições com falha | `http_req_failed: ['rate<0.001']` |
| Correção funcional | `checks: ['rate>0.999']` |
| O próprio teste manteve o cronograma | `dropped_iterations: ['count==0']` |
| Parar um teste breakpoint quando o SLO está claramente quebrado | `{ threshold: 'p(99)<1000', abortOnFail: true, delayAbortEval: '1m' }` |

Thresholds de percentis são avaliados sobre toda a execução do teste (ou sobre o subconjunto com a tag), e é por isso que o aquecimento precisa ser um cenário separado, fora da tag medida (veja [Metodologia — aquecimento](../methodology/index.md#warm-up)).

---

## Os seis tipos de teste

Cada tipo responde a uma pergunta diferente. Suas formas de carga, em relação ao pico esperado:

```python exec="1" html="1"
# The shape of each test type: arrival rate (as a fraction of the expected peak) over time.
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

def ramp(points):                      # piecewise-linear profile from (minute, level) points
    t = np.linspace(points[0][0], points[-1][0], 400)
    return t, np.interp(t, [p[0] for p in points], [p[1] for p in points])

SHAPES = [
    ("Smoke", "minutes", ramp([(0, 0.01), (1, 0.01)])),
    ("Load", "minutes", ramp([(0, 0), (5, 1.0), (25, 1.0), (28, 0)])),
    ("Stress", "minutes", ramp([(0, 0), (5, 1.0), (10, 1.0), (12, 1.5), (17, 1.5), (19, 2.0),
                                (24, 2.0), (26, 0.3), (31, 0.3)])),
    ("Spike", "minutes", ramp([(0, 0.05), (2, 0.05), (2.5, 1.5), (7.5, 1.5), (8, 0.05), (12, 0.05)])),
    ("Soak", "hours", ramp([(0, 0), (0.2, 0.4), (8, 0.4), (8.2, 0)])),
    ("Breakpoint", "minutes", ramp([(0, 0), (40, 4.0)])),
]

fig, axes = plt.subplots(2, 3, figsize=(11, 5), sharey=True)
for ax, (name, unit, (t, y)) in zip(axes.flat, SHAPES):
    ax.fill_between(t, y, color="#4C9BE8", alpha=0.25)
    ax.plot(t, y, color="#4C9BE8", linewidth=2)
    ax.axhline(1.0, color="#F28E2B", linestyle="--", linewidth=1)
    ax.set_title(name, fontweight="bold", color="gray")
    ax.set_xlabel(unit, color="gray")
    ax.tick_params(colors="gray", labelsize=8)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
axes[0][0].set_ylabel("× expected peak", color="gray")
axes[1][0].set_ylabel("× expected peak", color="gray")
axes[1][2].text(1, 3.3, "abort when the\nthresholds fail", color="gray", fontsize=8)
axes[0][0].text(0.05, 1.08, "expected peak", color="#F28E2B", fontsize=8)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

| Tipo | Pergunta que responde | Carga | Duração | Passa quando |
|---|---|---|---|---|
| **Smoke** | O script funciona e o sistema responde corretamente com carga mínima? | 1–2 VUs | 1–2 min | Zero erros, todos os checks passam |
| **Load** | O sistema cumpre os SLOs na carga esperada (de pico)? | Pico esperado, mix realista | 15–60 min no platô | Todos os thresholds passam |
| **Stress** | Como ele se comporta *acima* do pico esperado — com elegância ou de forma catastrófica? Ele se recupera? | Degraus até 1,5×, 2× o pico, depois volta | 20–40 min | Degrada rejeitando rápido (429/503), recupera-se sozinho |
| **Spike** | Ele absorve um salto repentino (10:00:00) — atraso do autoscaling, caches frios, sala de espera? | Base → 1–2× o pico em segundos | 5–15 min | Erros limitados durante o salto; de volta ao SLO em N minutos |
| **Soak** (resistência) | Ele continua saudável por horas — vazamentos, crescimento, degradação lenta? | ~Carga média diária | 4–24 h | Tendências planas de memória, latência e erros |
| **Breakpoint** | Onde está o joelho e onde está o ponto de ruptura? Qual recurso quebra primeiro? | Rampa contínua muito acima do pico | Até abortar | Não é aprovado/reprovado: o resultado é o número de capacidade |

### Teste smoke

O teste smoke é a verificação "isso pelo menos roda?" — rode-o depois de cada mudança no script ou no sistema, e como primeiro passo na CI. Um modelo fechado com um ou dois VUs serve aqui.

```javascript title="k6/smoke.js"
import { browse, search, hold } from './lib/boxoffice.js';

export const options = {
  vus: 2,
  duration: '1m',
  thresholds: {
    http_req_failed: ['rate==0'],
    checks: ['rate==1'],
  },
};

export default function () {
  browse();
  search();
  hold();
}
```

### Teste load

O teste load é o veredito principal: o mix realista, na taxa de chegada do pico esperado, por tempo suficiente para atingir o regime permanente. Cada fluxo ganha o próprio cenário **aberto** com sua fatia da taxa, de modo que o mix continua certo mesmo quando um endpoint fica lento.

```javascript title="k6/load.js"
import { browse, search, hold, checkout } from './lib/boxoffice.js';
export { browse, search, hold, checkout };

const PEAK = Number(__ENV.PEAK || 1000);           // iterations/s at peak (scaled for the lab)

function flow(exec, share, iterSeconds) {
  const rate = Math.round(PEAK * share);
  return {
    executor: 'ramping-arrival-rate',
    exec,
    startRate: 0,
    timeUnit: '1s',
    preAllocatedVUs: Math.ceil(rate * iterSeconds),        // Little's Law: VUs = rate × duration
    maxVUs: Math.ceil(rate * iterSeconds * 3),
    stages: [
      { target: rate, duration: '5m' },                    // ramp up
      { target: rate, duration: '20m' },                   // plateau at the expected peak
      { target: 0, duration: '2m' },                       // ramp down
    ],
  };
}

export const options = {
  scenarios: {
    browse:   flow('browse',   0.55, 0.2),
    search:   flow('search',   0.15, 0.3),
    hold:     flow('hold',     0.20, 3.5),
    checkout: flow('checkout', 0.10, 1.0),
  },
  thresholds: {
    'http_req_duration{name:GET /events/{id}}':       ['p(99)<200'],
    'http_req_duration{name:GET /events/{id}/seats}': ['p(99)<300'],
    'http_req_duration{name:GET /search}':            ['p(99)<400'],
    'http_req_duration{name:POST /holds}':            ['p(99)<300'],
    'http_req_duration{name:POST /orders}':           ['p(99)<800'],
    http_req_failed: ['rate<0.001'],
    checks: ['rate>0.999'],
    dropped_iterations: ['count==0'],
  },
};
```

As fatias são de *iterações*; como `hold()` faz duas requisições, calibre as fatias para que o mix de *requisições* resultante corresponda ao modelo de carga (o resumo do k6 ao fim do teste mostra as requisições por `name`).

### Teste stress

O teste stress vai além do pico esperado em degraus, mantém cada degrau tempo suficiente para observar e depois volta, para ver se o sistema **se recupera sozinho**. O resultado interessante não é "aprovado/reprovado", e sim *como* ele falha:

- **Com elegância**: acima da capacidade, o gateway ou o serviço rejeita o excesso rapidamente (429/503 em milissegundos), a latência das requisições aceitas fica perto do SLO, e tudo volta ao normal quando a carga cai. É isso que [rate limiting e load shedding](../../reliability/patterns/index.md) compram.
- **De forma catastrófica**: tudo fica lento, timeouts disparam retries, retries acrescentam carga (uma [tempestade de retries](../../../../playground/index.md)), o pool de conexões e as threads se esgotam, e o sistema continua degradado *depois* que a carga cai (pressão de memória, um backlog de trabalho enfileirado, circuit breakers oscilando).

```javascript title="k6/stress.js"
import { browse, hold } from './lib/boxoffice.js';
export { browse, hold };

const PEAK = Number(__ENV.PEAK || 1000);
const steps = (share) => [
  { target: PEAK * share,       duration: '5m' },   // 1× peak
  { target: PEAK * share,       duration: '5m' },
  { target: PEAK * share * 1.5, duration: '2m' },   // 1.5×
  { target: PEAK * share * 1.5, duration: '5m' },
  { target: PEAK * share * 2,   duration: '2m' },   // 2×
  { target: PEAK * share * 2,   duration: '5m' },
  { target: PEAK * share * 0.3, duration: '2m' },   // back to normal: does it recover?
  { target: PEAK * share * 0.3, duration: '5m' },
];

export const options = {
  scenarios: {
    browse: { executor: 'ramping-arrival-rate', exec: 'browse', startRate: 0, timeUnit: '1s',
              preAllocatedVUs: 400, maxVUs: 4000, stages: steps(0.75) },
    hold:   { executor: 'ramping-arrival-rate', exec: 'hold', startRate: 0, timeUnit: '1s',
              preAllocatedVUs: 1000, maxVUs: 10000, stages: steps(0.25) },
  },
  // No pass/fail on latency: the stress test is read on the dashboards.
  thresholds: { checks: ['rate>0.5'] },
};
```

### Teste spike

O teste spike reproduz as 10:00:00: de uma base tranquila a acima do pico em segundos. Ele exercita exatamente o que o teste load não consegue — atraso do autoscaling, caches frios, tempestades de conexões contra o banco e a sala de espera.

```javascript title="k6/spike.js"
import { hold } from './lib/boxoffice.js';
export { hold };

const PEAK = Number(__ENV.PEAK || 1000);

export const options = {
  scenarios: {
    onsale: {
      executor: 'ramping-arrival-rate', exec: 'hold', startRate: PEAK * 0.05, timeUnit: '1s',
      preAllocatedVUs: 2000, maxVUs: 12000,
      stages: [
        { target: PEAK * 0.05, duration: '2m' },   // quiet morning
        { target: PEAK * 1.5,  duration: '30s' },  // 10:00:00
        { target: PEAK * 1.5,  duration: '5m' },
        { target: PEAK * 0.05, duration: '30s' },
        { target: PEAK * 0.05, duration: '4m' },   // recovery window
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],                     // bounded errors during the jump
    'http_req_duration{name:POST /holds}': ['p(99)<1500'],
  },
};
```

Rode-o duas vezes — com o autoscaler no mínimo normal e com **pré-escala** — e compare os dois primeiros minutos. A diferença é o argumento a favor da pré-escala (veja [Kubernetes — autoscaling](../../cloud-native/kubernetes/index.md)).

Experimente: o cenário abaixo é a venda do BoxOffice — uma sala de espera (fila) na frente do `inventory`, assentos no SQL, pagamento por um provedor externo — pré-carregado com o perfil **spike**. Rode-o como está, depois remova ou contorne a fila (ou aumente sua taxa de admissão) e rode de novo. Compare o p99 das reservas, a utilização do banco e a taxa de erros. Para onde vai a carga excedente em cada caso?

<div class="sdp" data-scenario="flash-sale" data-mode="compact" data-profile="spike" data-height="560"></div>

### Teste soak { #soak-test }

O teste soak (de resistência) mantém uma carga realista — tipicamente a média diária — por horas. Ele encontra problemas que precisam de *tempo*: vazamentos de memória, vazamentos de conexões ou de descritores de arquivo, caches sem limite, volumes de log enchendo discos, tabelas crescendo devagar sem índice, renovações de certificados ou tokens que falham depois de N horas, e o comportamento do GC depois que o heap encheu uma vez.

```javascript title="k6/soak.js"
import { browse, search, hold } from './lib/boxoffice.js';
export { browse, search, hold };

const RATE = Number(__ENV.RATE || 300);           // ~ average daily load

export const options = {
  scenarios: {
    browse: { executor: 'constant-arrival-rate', exec: 'browse', rate: RATE * 0.7, timeUnit: '1s',
              duration: '8h', preAllocatedVUs: 100, maxVUs: 1000 },
    search: { executor: 'constant-arrival-rate', exec: 'search', rate: RATE * 0.2, timeUnit: '1s',
              duration: '8h', preAllocatedVUs: 50, maxVUs: 500 },
    hold:   { executor: 'constant-arrival-rate', exec: 'hold', rate: RATE * 0.1, timeUnit: '1s',
              duration: '8h', preAllocatedVUs: 150, maxVUs: 1500 },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    'http_req_duration{name:POST /holds}': ['p(99)<300'],
  },
};
```

Um teste soak é lido como **tendências**, não totais: o p99 na hora 8 vs na hora 1, e a inclinação do uso de recursos. Uma consulta PromQL como a abaixo, sobre a geração antiga do heap da JVM *depois* das coletas de lixo, deve ser plana; uma inclinação positiva constante é um vazamento.

```promql
deriv(jvm_memory_used_bytes{service="inventory", area="heap", id=~".*Old Gen"}[1h])
```

### Teste breakpoint

O teste breakpoint (de capacidade) aumenta a taxa de chegada continuamente, muito além do pico esperado, e se interrompe sozinho quando o sistema claramente quebra. Seu resultado é um número: o **joelho** (a maior taxa em que o SLO ainda vale) e o **ponto de ruptura** — mais o nome do recurso que saturou primeiro.

```javascript title="k6/breakpoint.js"
import { hold } from './lib/boxoffice.js';
export { hold };

export const options = {
  scenarios: {
    breakpoint: {
      executor: 'ramping-arrival-rate', exec: 'hold', startRate: 10, timeUnit: '1s',
      preAllocatedVUs: 1000, maxVUs: 20000,
      stages: [ { target: 4000, duration: '40m' } ],          // ~ +100 req/s per minute
    },
  },
  thresholds: {
    'http_req_duration{name:POST /holds}': [
      { threshold: 'p(99)<1000', abortOnFail: true, delayAbortEval: '1m' },
    ],
    http_req_failed: [ { threshold: 'rate<0.05', abortOnFail: true, delayAbortEval: '1m' } ],
  },
};
```

Nunca rode um teste breakpoint contra a produção, e sempre observe o **gerador de carga**: com milhares de VUs, uma única máquina de k6 pode virar o gargalo — verifique sua CPU e as `dropped_iterations`, e distribua o teste (k6-operator) quando necessário. A página [Encontrando gargalos](../bottlenecks/index.md) mostra como ler a curva resultante.

---

## Omissão coordenada

A omissão coordenada (*coordinated omission*) é o erro de medição que fez o teste do ano passado mentir[^3]. Ela acontece sempre que o gerador de carga **espera uma resposta antes de enviar a próxima requisição** e mede a latência **a partir do momento em que de fato enviou a requisição**. Quando o servidor trava, o testador para de enviar — então ele *omite* exatamente as requisições que teriam sofrido o travamento, em *coordenação* com o mau comportamento do servidor. As poucas amostras que ele registra durante o travamento se afogam entre milhares de rápidas.

A simulação abaixo reproduz isso. Um servidor responde em 1 ms, mas congela por 1,5 s quatro vezes durante um teste de 60 s — uma pausa stop-the-world do GC ou um lock de tabela. O testador pretende enviar 100 requisições por segundo. O laço fechado espera cada resposta; o modelo aberto envia no horário e mede a partir do horário *pretendido* de envio:

```python exec="1" html="1"
# Coordinated omission, simulated. A server answers in 1 ms, but freezes for
# 1.5 s four times in a 60 s test (think: a stop-the-world GC pause or a lock).
# The load generator intends to send 100 requests per second.
import matplotlib.pyplot as plt
import numpy as np
from io import StringIO

RATE, DURATION, SERVICE = 100, 60.0, 0.001
STALLS = [(10.0, 1.5), (25.0, 1.5), (40.0, 1.5), (55.0, 1.5)]   # (start, length) in s

def serve(arrival, free_at):
    start = max(arrival, free_at)
    for s, d in STALLS:
        if s <= start < s + d:
            start = s + d                 # frozen: nothing runs until the stall ends
    return start + SERVICE

# Closed loop: one virtual user, paced at 10 ms, waits for each response
# before sending the next one -> it stops sending while the server is frozen.
closed_t, closed_lat, t, slot, free = [], [], 0.0, 0.0, 0.0
while slot < DURATION:
    send = max(t, slot)
    done = serve(send, free)
    free = done
    closed_t.append(send)
    closed_lat.append(done - send)        # measured from the ACTUAL send time
    t, slot = done, slot + 1 / RATE
    if slot < t:
        slot = t                          # the missed slots are silently skipped

# Open model: requests arrive on schedule whether or not the server keeps up;
# latency is measured from the INTENDED send time.
open_t = np.arange(0, DURATION, 1 / RATE)
open_lat, free = [], 0.0
for a in open_t:
    done = serve(a, free)
    free = done
    open_lat.append(done - a)

def row(name, lat):
    ms = np.array(lat) * 1000
    cells = [f"{len(ms):,}"] + [f"{v:.1f}" for v in np.percentile(ms, [50, 90, 99, 99.9])] + [f"{ms.max():.0f}"]
    return f"<tr><td>{name}</td>" + "".join(f"<td style='text-align:right'>{c}</td>" for c in cells) + "</tr>"

print("<table><thead><tr><th>Measurement (latency in ms)</th><th>Samples</th><th>p50</th>"
      "<th>p90</th><th>p99</th><th>p99.9</th><th>max</th></tr></thead><tbody>"
      + row("Closed loop (coordinated omission)", closed_lat)
      + row("Open model / corrected", open_lat) + "</tbody></table>")

fig, ax = plt.subplots(figsize=(11, 3.6))
ax.plot(open_t, np.array(open_lat) * 1000, color="#F28E2B", linewidth=1.5, label="open model: what users would see")
ax.scatter(closed_t, np.array(closed_lat) * 1000, s=8, color="#4C9BE8", rasterized=True,
           label="closed loop: what the tool recorded")
ax.set_yscale("symlog", linthresh=1)
ax.set_xlabel("test time (s)", color="gray")
ax.set_ylabel("latency (ms, log)", color="gray")
ax.set_title("Same server, same 60 s: two very different reports", fontweight="bold", color="gray")
ax.tick_params(colors="gray")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
ax.legend(frameon=False, labelcolor="gray", loc="center left")
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

O servidor e seus quatro congelamentos são idênticos; só a medição difere. O laço fechado registrou ~600 amostras a menos (as que ele nunca enviou durante os congelamentos) e reporta um p99 perfeito de 1 ms. Na realidade, cerca de uma requisição em dez naquele minuto teria esperado entre alguns milissegundos e 1,5 s — o p90 corrigido é ~150 ms e o p99 passa de um segundo. **Um SLO verificado com a primeira linha passa; verificado com a segunda, falha. Os usuários experimentam a segunda.**

Como evitar:

- **Use geradores de modelo aberto** para tráfego de mundo aberto: `constant-arrival-rate`/`ramping-arrival-rate` do k6, `injectOpen` do Gatling, wrk2, vegeta. Eles iniciam as requisições no horário, independentemente das respostas anteriores (desde que tenham VUs/conexões livres — observe `dropped_iterations`).
- **Meça a partir do horário pretendido de início** quando você controla o cliente (`recordValueWithExpectedInterval` do HdrHistogram, a correção do wrk2).
- **Conte os timeouts com sua duração total** e como erros; um teste que descarta requisições que expiraram também omite as piores amostras.
- **Cuidado com métricas do lado do servidor** como única fonte: o histograma de latência do próprio servidor começa o relógio quando a requisição é *aceita*, perdendo o tempo passado na fila de accept do TCP ou no load balancer. Compare os percentis do lado do cliente e do servidor; uma diferença grande significa fila na frente do serviço.

---

## Think time e cadência

Usuários reais fazem pausas entre ações. O **think time** (`sleep()` entre as requisições dentro de uma iteração) torna uma sessão realista; a **cadência** (*pacing*) controla com que frequência uma iteração inteira começa.

- Em um modelo **fechado**, o think time *reduz* a vazão para um dado número de VUs ($X = N/(R+Z)$). Removê-lo para "gerar mais carga" muda a população que você está simulando.
- Em um modelo **aberto**, a taxa de chegada fixa a vazão; o think time só aumenta o número de VUs ocupados ao mesmo tempo (VUs ≈ taxa × duração da iteração) — e portanto o número de sessões concorrentes, conexões abertas e assentos reservados, o que é realista e frequentemente exatamente onde os sistemas quebram.
- Torne os think times aleatórios (`1 + Math.random() * 3`): pausas constantes sincronizam os VUs em ondas artificiais.

---

## Executando, observando e correlacionando

Um teste de carga produz dois conjuntos de dados que precisam ser lidos **juntos**: os resultados do lado do cliente (k6) e a telemetria do lado do servidor (métricas, traces, logs, perfis). Coloque-os no mesmo eixo de tempo:

```bash
# stream k6 metrics to Prometheus (remote write) and tag the run
K6_PROMETHEUS_RW_SERVER_URL=http://localhost:9090/api/v1/write \
K6_PROMETHEUS_RW_TREND_STATS="p(50),p(95),p(99),max" \
k6 run --out experimental-prometheus-rw --tag testid=onsale-2027-03-14-run2 \
       -e BASE_URL=https://perf.boxoffice.example -e PEAK=1200 k6/load.js

# or watch the built-in web dashboard and export an HTML report
K6_WEB_DASHBOARD=true K6_WEB_DASHBOARD_EXPORT=report.html k6 run k6/load.js
```

Com o k6 e as métricas OpenTelemetry dos serviços no mesmo Grafana (a stack `grafana/otel-lgtm` do [Hands-on 8](../../../hands-on/8/index.md)), um único dashboard mostra a taxa de chegada e o p99 do k6 ao lado das métricas RED de cada serviço e das métricas USE de cada recurso. Requisições lentas são encontradas por **exemplars de trace**, e seus spans mostram para onde foi o tempo. Para testes além de uma máquina, o **k6-operator** executa um teste como vários pods paralelos em um cluster Kubernetes.

---

## Carga e caos juntos

Falhas raramente chegam em uma tarde tranquila; elas chegam no pico, quando retries, timeouts e pools estão todos sob pressão. Testar padrões de resiliência *sem* carga prova pouco: um circuit breaker que nunca viu 2 000 requisições concorrentes não foi testado. Combine um teste de carga com injeção de falhas[^4], cada uma com uma hipótese escrita com antecedência ([Engenharia do caos](../../reliability/chaos/index.md)):

| Falha injetada durante o teste de carga | Hipótese | Ferramenta |
|---|---|---|
| Provedor de pagamento +3 s de latência | O circuit breaker abre em até 10 s; reservas e navegação mantêm o SLO; pedidos falham rápido com uma mensagem clara | Toxiproxy, xk6-disruptor |
| Matar 1 de 3 pods de `inventory` | Pico de erros < 1 % por < 30 s; o p99 se recupera sem ação manual | `kubectl delete pod`, Chaos Mesh |
| Redis indisponível por 60 s | O catálogo recorre ao PostgreSQL; o p99 sobe mas fica < 1 s; sem estouro de requisições (*stampede*) na volta | Toxiproxy, Chaos Mesh |
| Failover do PostgreSQL | Escritas falham por < 30 s; o pool de conexões se recupera; sem threads presas | API de failover do banco gerenciado |

```bash title="chaos-under-load.sh — Toxiproxy between order and payment"
k6 run -e PEAK=800 k6/load.js &                       # steady load in the background
sleep 300                                             # 5 minutes of baseline
toxiproxy-cli toxic add --type latency --attribute latency=3000 --attribute jitter=500 \
              --toxicName slow-payment payment        # inject: provider answers in ~3 s
sleep 300                                             # 5 minutes degraded
toxiproxy-cli toxic remove --toxicName slow-payment payment   # recover
wait                                                  # compare the three phases in Grafana
```

Com o **xk6-disruptor** (uma extensão do k6), a falha faz parte do script de teste e atinge diretamente um Service do Kubernetes:

```javascript title="k6/chaos-payment.js (requires a k6 binary built with xk6-disruptor)"
import { ServiceDisruptor } from 'k6/x/disruptor';
import { checkout } from './lib/boxoffice.js';
export { checkout };

export const options = {
  scenarios: {
    load:  { executor: 'constant-arrival-rate', exec: 'checkout', rate: 200, timeUnit: '1s',
             duration: '15m', preAllocatedVUs: 400, maxVUs: 2000 },
    fault: { executor: 'shared-iterations', exec: 'disrupt', iterations: 1, vus: 1, startTime: '5m' },
  },
  thresholds: { 'http_req_duration{name:POST /orders}': ['p(99)<1500'] },
};

export function disrupt() {
  const payment = new ServiceDisruptor('payment', 'boxoffice');
  payment.injectHTTPFaults({ averageDelay: '3s', errorRate: 0.1, errorCode: 503 }, '5m');
}
```

Experimente: o cenário abaixo tem uma dependência de terceiros lenta e chamadores **sem timeouts**, rodando com o perfil **chaos**. Rode-o e observe as threads (ou a concorrência) se acumularem nos chamadores até que requisições não relacionadas também falhem — uma falha em cascata. Depois ative o timeout e o circuit breaker na chamada à dependência e rode de novo: a falha deve ficar contida à funcionalidade que precisa da dependência.

<div class="sdp" data-scenario="cascading-failure" data-mode="compact" data-profile="chaos" data-chaos="medium" data-height="520"></div>

---

## Do playground às ferramentas reais

Os perfis de carga do playground são os mesmos seis tipos de teste (mais o caos), aplicados a uma simulação de filas. Use o playground para construir intuição e formular hipóteses rapidamente; confirme-as com ferramentas reais em serviços reais.

| Perfil do playground | O que o playground faz | k6 | Gatling | Locust |
|---|---|---|---|---|
| `smoke` | Um fio de requisições para verificar se o design funciona de ponta a ponta | `constant-vus`, 1–2 VUs | `atOnceUsers(1)` | `-u 1 -r 1` |
| `load` | Sobe até a taxa-alvo e mantém | `ramping-arrival-rate` → platô | `rampUsersPerSec(...).to(...)`, `constantUsersPerSec(...)` | `LoadTestShape` rampa + platô |
| `stress` | Degraus acima da meta, depois volta | `ramping-arrival-rate` com degraus | `incrementUsersPerSec(...).times(n)` | `LoadTestShape` em degraus |
| `spike` | Um salto repentino para um múltiplo da base | `ramping-arrival-rate`, estágio de segundos | `nothingFor`, `atOnceUsers`, `constantUsersPerSec` | `LoadTestShape` com salto |
| `soak` | Uma taxa longa, moderada e constante | `constant-arrival-rate`, horas | `constantUsersPerSec(...).during(hours)` | `-t 8h` com cadência |
| `breakpoint` | Uma taxa sempre crescente até o SLO quebrar | `ramping-arrival-rate` + `abortOnFail` | `rampUsersPerSec` + `assertions` | `LoadTestShape` + condição de parada |
| `chaos` | Carga mais falhas injetadas (latência, erros, perda de instâncias) no nível de caos escolhido | script de carga + xk6-disruptor / Toxiproxy | carga + Toxiproxy | carga + Toxiproxy |

O que o playground **simplifica**: ele modela capacidade, tempos de serviço, filas, timeouts, retries e falhas, mas não o aquecimento do JIT, a coleta de lixo, a contenção de locks dentro de um banco, a variância da rede nem o custo do seu código real. Um design que falha no playground vai falhar na realidade; um design que passa no playground ainda precisa ser medido.

---

## Outras ferramentas

Todas as ferramentas abaixo conseguem expressar os seis tipos de teste; elas diferem na linguagem de script, no suporte ao modelo aberto, na distribuição e nos relatórios[^5].

=== "Gatling"

    DSL em Java/Kotlin/Scala, perfis de injeção abertos e fechados, relatórios HTML detalhados. Forte para times de JVM.

    ```java
    public class HoldSimulation extends Simulation {
      HttpProtocolBuilder httpProtocol = http.baseUrl("http://localhost:8080");

      ScenarioBuilder holds = scenario("hold")
          .exec(http("GET /events/{id}/seats").get("/events/42/seats?available=true").check(status().is(200)))
          .pause(1, 4)
          .exec(http("POST /holds").post("/holds")
              .body(StringBody("{\"eventId\":42,\"seatIds\":[\"A-12\"]}")).asJson());

      {
        setUp(holds.injectOpen(
                rampUsersPerSec(0).to(500).during(300),
                constantUsersPerSec(500).during(1200)))
            .protocols(httpProtocol)
            .assertions(
                global().responseTime().percentile(99.0).lt(300),
                global().failedRequests().percent().lt(0.1));
      }
    }
    ```

=== "Locust"

    Python, classes de usuário com tarefas e tempos de espera; uma UI web e workers distribuídos. Cada usuário é um laço fechado; use a cadência `constant_throughput` e muitos usuários para aproximar um modelo aberto.

    ```python
    from locust import HttpUser, task, between

    class Fan(HttpUser):
        wait_time = between(1, 4)          # think time

        @task(7)
        def event_page(self):
            self.client.get("/events/42", name="GET /events/{id}")

        @task(3)
        def hold(self):
            self.client.post("/holds", json={"eventId": 42, "seatIds": ["A-12"]}, name="POST /holds")
    ```

=== "JMeter"

    O veterano: GUI para montar planos, CLI para executá-los, muitos protocolos. Thread groups são de modelo fechado; use o *Constant Throughput Timer* ou o plugin *Arrivals Thread Group* para taxas de chegada.

    ```bash
    jmeter -n -t onsale.jmx -l results.jtl -e -o report/    # headless run + HTML report
    ```

=== "wrk2 / vegeta"

    Geradores HTTP de linha de comando com taxa constante: ideais para um endpoint, verificações rápidas e distribuições de latência sem omissão coordenada.

    ```bash
    # wrk2: constant 5 000 req/s, latency corrected for coordinated omission
    wrk2 -t4 -c200 -d60s -R5000 --latency http://localhost:8080/events/42

    # vegeta: constant 2 000 req/s, latency histogram
    echo "GET http://localhost:8080/events/42" | vegeta attack -rate=2000/s -duration=60s \
      | vegeta report -type='hist[0,50ms,100ms,200ms,500ms,1s]'
    ```

| Ferramenta | Linguagem | Modelo aberto | Distribuída | Melhor para |
|---|---|---|---|---|
| **k6** | JavaScript (motor em Go) | Sim (executors de taxa de chegada) | k6-operator, nuvem | Cenários com script, gates de CI, thresholds |
| **Gatling** | Java/Kotlin/Scala | Sim (`injectOpen`) | Edição enterprise | Times de JVM, relatórios ricos |
| **Locust** | Python | Aproximado | Sim (workers) | Times de Python, protocolos customizados |
| **JMeter** | Planos XML (GUI) | Com plugins | Sim | Muitos protocolos, suítes legadas |
| **wrk2**, **vegeta** | CLI | Sim (taxa constante) | Não | Endpoints isolados, números rápidos sem omissão coordenada |

!!! tip "Na entrevista"

    Duas frases sinalizam experiência real: "Eu usaria um teste de **modelo aberto** — taxa de chegada, não usuários virtuais — porque fãs não esperam uns pelos outros; um modelo fechado recua quando o sistema fica lento e esconde a fila (**omissão coordenada**)." e "Os thresholds são os **SLOs por endpoint**, e eu rodaria testes load, spike e breakpoint: o load para o veredito, o spike para o atraso do autoscaling e a sala de espera, o breakpoint para o joelho e a folga."

!!! warning "Armadilhas"

    - **Modelo fechado para tráfego de internet**: a vazão cai exatamente quando a latência sobe; o teste é mais gentil que a realidade.
    - **Ignorar `dropped_iterations`**: um teste de taxa de chegada sem VUs suficientes vira fechado em silêncio.
    - **Um threshold para todos os endpoints**: uma página de evento rápida esconde um `POST /holds` lento.
    - **Contar 409 (esgotado) como erro** — ou contar 503 como sucesso.
    - **URLs sem nome**: milhares de séries de métricas e nenhum veredito por endpoint.
    - **Gerador de carga no mesmo cluster** (ou no mesmo nó) do sistema sob teste: eles disputam CPU e rede.
    - **Caos sem carga** (ou carga sem caos): padrões de resiliência só são provados no pico.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    SLO["SLOs per endpoint"] --> THR["k6 thresholds:<br/>pass or fail"]
    WM{"workload model"} -->|"open: arrival rate"| OPEN["fans do not wait<br/>for each other"]
    WM -->|"closed: virtual users"| CLOSED["coordinated omission<br/>hides the queue"]
    OPEN --> TYPES["smoke, load, stress,<br/>spike, soak, breakpoint"]
    THR --> TYPES
    TYPES --> KNEE["breakpoint finds the knee<br/>→ Capacity planning"]
    TYPES --> LAG["spike shows autoscaling lag<br/>→ Cloud-native Kubernetes"]
    TYPES --> CHAOS["load + Toxiproxy faults<br/>→ Reliability chaos"]
    TYPES --> CORR["correlate with metrics<br/>and traces → Hands-on 8"]
```

**Componentes da paleta:** [`client`](../../../reference/components/client/index.md#client) e [`mobile`](../../../reference/components/client/index.md#mobile) (o que o gerador de carga imita) · [`apigw`](../../../reference/components/edge/index.md#apigw) e [`lb`](../../../reference/components/edge/index.md#lb) (onde a rejeição elegante — `429`/`503` — deve acontecer além da capacidade) · [`app`](../../../reference/components/compute/index.md#app) (as réplicas sob teste) · [`queue`](../../../reference/components/messaging/index.md#queue) (a sala de espera no teste de pico) · [`thirdparty`](../../../reference/components/external/index.md#thirdparty) (a dependência que o Toxiproxy deixa lenta) · [`metrics`](../../../reference/components/observability/index.md#metrics) e [`tracing`](../../../reference/components/observability/index.md#tracing) (correlacionar os resultados do k6 com o lado do servidor). **Cenários:** `flash-sale` (pico), `cascading-failure` (carga e caos juntos); os perfis `smoke`, `load`, `stress`, `spike`, `soak` e `breakpoint` espelham os seis tipos de teste. **Continua em:** [Planejamento de capacidade](../capacity-planning/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Confiabilidade — engenharia do caos](../../reliability/chaos/index.md), [Confiabilidade — padrões](../../reliability/patterns/index.md), [Estimativas — percentis](../../estimation/percentiles/index.md), [Hands-on 2](../../../hands-on/2/index.md).

---

[^1]: Grafana Labs. [k6 documentation](https://grafana.com/docs/k6/latest/){target="_blank"} — cenários e executors, thresholds, tipos de teste.
[^2]: SCHROEDER, B.; WIERMAN, A.; HARCHOL-BALTER, M. [Open Versus Closed: A Cautionary Tale](https://www.usenix.org/conference/nsdi-06/open-versus-closed-cautionary-tale){target="_blank"}. *USENIX NSDI*, 2006.
[^3]: TENE, G. [How NOT to Measure Latency](https://www.infoq.com/presentations/latency-response-time/){target="_blank"}. QCon / InfoQ, 2015; [wrk2](https://github.com/giltene/wrk2){target="_blank"}.
[^4]: Toxiproxy. [A TCP proxy to simulate network and system conditions](https://github.com/Shopify/toxiproxy){target="_blank"}; Grafana Labs. [xk6-disruptor](https://grafana.com/docs/k6/latest/testing-guides/injecting-faults-with-xk6-disruptor/){target="_blank"}.
[^5]: Gatling. [Documentation](https://docs.gatling.io/){target="_blank"}; Locust. [Documentation](https://docs.locust.io/){target="_blank"}.
