O negócio faz uma pergunta simples: "Podemos abrir a venda do show no estádio em 14 de março às 10:00?" Por trás dela há perguntas de engenharia com respostas numéricas: quantas réplicas de cada serviço, que tamanho de banco, quantas conexões, que taxa de admissão para a sala de espera, com quanta antecedência escalar — e quanto custa. O **planejamento de capacidade**[^2] transforma as medições das páginas anteriores nesses números, com margem suficiente para sobreviver ao que você não previu.

---

## De medições a réplicas

Planejamento de capacidade é aritmética sobre três entradas que você já sabe obter:

1. **Demanda** — a taxa de chegada de pico por endpoint, do [modelo de carga](../methodology/index.md#workload-model) (previsão × fator de segurança).
2. **Capacidade por unidade** — o **joelho** de um pod (ou de um banco), de um [teste breakpoint](../load-testing/index.md): a maior taxa em que ele ainda cumpre o SLO.
3. **Folga** (*headroom*) — quão abaixo do joelho você quer operar, e a quais falhas precisa sobreviver.

$$
\text{réplicas} = \left\lceil \frac{\text{demanda de pico}}{\text{joelho por réplica} \times (1 - \text{folga})} \right\rceil
\quad\text{e depois some réplicas para sobreviver à perda de uma zona}
$$

### A Lei de Little dimensiona tudo o que segura uma requisição

Réplicas não são o único recurso. Todo componente que *segura* uma requisição enquanto ela está em andamento — threads, conexões, sockets, VUs, posições de fila — precisa ser dimensionado para a concorrência, e a Lei de Little a dá diretamente: **concorrência = taxa de chegada × tempo em que é segurada**[^1].

| Recurso | Taxa | Tempo segurado | Concorrência necessária |
|---|---|---|---|
| Threads de requisição do `inventory` | 3 000 reservas/s | 120 ms (p50 da resposta) | 360 threads somando todos os pods — mais para a cauda |
| Conexões do PostgreSQL | 3 000 reservas/s | 6 ms por transação | 18 conexões ativas (atrás do PgBouncer) |
| VUs do k6 para o teste de carga | 1 000 iterações de `hold()`/s | 3,5 s por iteração | 3 500 VUs |
| Sala de espera | 500 fãs admitidos/s | posição 600 000 na fila | 600 000 / 500 = 1 200 s: uma espera de 20 minutos para mostrar ao fã |

### Um modelo de capacidade para a venda

O modelo abaixo combina as taxas de pico do modelo de carga com os joelhos por pod medidos em testes breakpoint (todos os valores são premissas ilustrativas — troque-os pelas suas medições). Ele planeja operar no máximo a 75 % do joelho e espalha as réplicas por três zonas de disponibilidade, para que a perda de uma zona ainda deixe capacidade suficiente:

```python exec="1" html="1"
# Capacity model for the on-sale. Inputs are ASSUMPTIONS: peak demand from the
# workload model, per-pod knees from breakpoint tests. Change them and re-run.
import math

HEADROOM = 0.25          # plan to run at most at 75 % of the measured knee
ZONES = 3                # replicas spread over 3 availability zones; survive losing one
POOL = 10                # connections per pod (services that use PostgreSQL)

# service: (peak req/s without waiting room, peak with waiting room, knee per pod, uses SQL?)
SERVICES = {
    "gateway":   (30000, 30000, 4000, False),
    "catalog":   (19500, 19500, 1500, True),
    "search":    (3000,  3000,  600,  False),
    "inventory": (4500,  3000,  275,  True),
    "order":     (3000,  2000,  150,  True),
}

def pods(demand, knee):
    base = math.ceil(demand / (knee * (1 - HEADROOM)))
    survive_zone = math.ceil(base * ZONES / (ZONES - 1))      # after losing 1 zone, base remains
    return base, ZONES * math.ceil(survive_zone / ZONES)        # round up to a multiple of 3

rows, conns = [], {"no": 0, "wr": 0}
for name, (d_no, d_wr, knee, sql) in SERVICES.items():
    b_no, p_no = pods(d_no, knee)
    b_wr, p_wr = pods(d_wr, knee)
    if sql:
        conns["no"] += p_no * POOL
        conns["wr"] += p_wr * POOL
    rows.append(f"<tr><td><code>{name}</code></td><td>{knee:,}</td>"
                f"<td>{d_no:,}</td><td>{b_no} → <strong>{p_no}</strong></td>"
                f"<td>{d_wr:,}</td><td>{b_wr} → <strong>{p_wr}</strong></td></tr>")

print("<table><thead><tr><th>Service</th><th>Knee per pod (req/s)</th>"
      "<th>Peak, no waiting room</th><th>Pods (load → +zone loss)</th>"
      "<th>Peak, waiting room</th><th>Pods (load → +zone loss)</th></tr></thead><tbody>"
      + "".join(rows) +
      f"<tr><td><strong>PostgreSQL client connections</strong></td><td>pool {POOL}/pod</td>"
      f"<td></td><td><strong>{conns['no']:,}</strong></td><td></td><td><strong>{conns['wr']:,}</strong></td></tr>"
      "</tbody></table>")
```

O que o modelo diz:

- **A sala de espera economiza capacidade onde ela é mais cara.** Limitar as reservas admitidas a 3 000/s (abaixo do joelho do banco) corta cerca de um terço das réplicas de `inventory` e `order` — e, mais importante, mantém limitada a carga sobre o único banco primário.
- **Resiliência a zonas custa 50 % mais réplicas** no pico. Esse é o preço de "uma queda de zona às 10:01 não para a venda". Pode valer a pena no dia da venda e não em uma terça-feira — os limites do autoscaling podem variar por dia.
- **O número de conexões é um sinal de alerta.** Perto de mil conexões de clientes não podem ir direto ao PostgreSQL; o PgBouncer (transaction pooling) as multiplexa em algumas dezenas de conexões de servidor — o número que a Lei de Little de fato exige.
- **Pods viram nós, que viram dólares.** Cerca de cem pods no pico é aproximadamente o "+24 nós por 2 horas" do [modelo de custo de FinOps](../../cloud-native/finops/index.md).

---

## Folga: por que não operar a 100 % do joelho?

| Motivo para a folga | O que acontece sem ela |
|---|---|
| **Erro de previsão** | O show é mais popular do que o esperado; a demanda passa do plano |
| **Rajadas de menos de um minuto** | Dashboards fazem médias por minuto; dentro dele, alguns segundos carregam 2–3× a média |
| **Falhas** | Uma zona, um nó ou um pod se perde; os sobreviventes absorvem sua carga |
| **Deploys** | Rolling updates e canaries removem ou desviam capacidade temporariamente |
| **Atraso do autoscaling** | A nova capacidade chega minutos depois da demanda |
| **Vizinhos barulhentos, GC, compactação** | A capacidade por pod varia de execução para execução |

Metas típicas operam os serviços entre 50 e 75 % do joelho no pico esperado; o número certo depende de quão rápido você consegue adicionar capacidade e de quão caro é violar o SLO. Para a venda do BoxOffice — que dura minutos, é muito visível e não pode ser repetida —, uma folga generosa é um seguro barato.

---

## Atraso do autoscaling: os minutos que importam

O autoscaling reage à demanda; ele não a antecipa. Uma linha do tempo aproximada para um serviço JVM no Kubernetes quando o pico começa:

| Etapa | Duração típica |
|---|---|
| O pipeline de métricas percebe a mudança (scrape + agregação) | 15–60 s |
| Avaliação e decisão do HPA | até 15 s |
| Pod escalonado — **se** um nó tiver espaço; senão, provisionamento de nó | segundos / 1–3 min |
| Download da imagem em um nó novo | segundos a um minuto |
| Início da JVM, contexto Spring, readiness, aquecimento do JIT | 20–60 s |
| **Total** | **≈ 1–4 minutos** |

Durante essa janela, o backlog cresce na diferença entre demanda e capacidade. Se as reservas saltam de 500/s para 4 500/s enquanto o deployment consegue atender 1 100/s por dois minutos, o backlog é $(4\,500 - 1\,100) \times 120 \approx 408\,000$ requisições — muito além de qualquer timeout. Elas viram erros, os retries pioram tudo, e os fãs que chegaram primeiro têm a pior experiência. Daí as regras para picos **conhecidos**:

- **Pré-escale** antes do evento (um aumento agendado às 09:45; o scaler de cron do KEDA; `minReplicas` elevado) e mantenha capacidade livre nos nós.
- **Controle de admissão** (sala de espera, rate limiting), para que a demanda excedente espere *fora* do sistema, em ordem, em vez de expirar dentro dele[^3].
- **Aqueça** a nova capacidade: caches pré-carregados com o evento, pools de conexão cheios (`minimum-idle = maximum-pool-size`), uma requisição de aquecimento a cada pod novo antes de ele ficar pronto.

Plataformas serverless encurtam o atraso, mas não o eliminam: novas instâncias de função têm **cold starts**, e os provedores limitam quão rápido a concorrência pode crescer e quanta concorrência uma conta pode usar (verifique as cotas atuais do seu provedor).

Experimente: o cenário abaixo envia uma rajada a um componente serverless. Rode-o com as configurações padrão e observe a latência de cold start no início da rajada e as requisições estranguladas (rejeitadas) quando o limite de concorrência é atingido. Depois aumente o limite ou adicione concorrência provisionada (pré-aquecida) e compare os primeiros segundos da rajada — a versão serverless da pré-escala.

<div class="sdp" data-scenario="serverless-burst" data-mode="compact" data-profile="spike" data-height="520"></div>

---

## Previsão e a revisão de capacidade

Planejamento de capacidade não se faz uma vez só. Um processo simples e sustentável:

- **Preveja** a demanda a partir do histórico: tendência (crescimento por mês), sazonalidade (fins de semana, feriados) e **eventos** (vendas são anunciadas com antecedência — use o calendário, não só a tendência).
- **Meça de novo** a capacidade por unidade depois de cada mudança significativa; uma nova funcionalidade pode mover o joelho mais do que qualquer mudança de infraestrutura. O orçamento de desempenho na CI (abaixo) pega a maioria das regressões antes que cheguem à produção.
- **Revise** mensalmente: utilização de pico vs plano, folga restante, custo por unidade de demanda, eventos futuros. Capacidade, SLOs e custo pertencem à mesma reunião.
- **Prefira elasticidade a precisão**: um sistema que escala em um minuto precisa de uma previsão menos precisa do que um que precisa de uma semana para comprar hardware.

---

## Orçamentos de desempenho na CI { #performance-budgets }

Uma regressão de desempenho que chega à produção é descoberta pelos fãs. Um **orçamento de desempenho** (*performance budget*) é um limite — por endpoint, por página, por build — que o pipeline impõe a cada mudança, da mesma forma que os testes impõem a correção[^4]. Orçamentos úteis misturam medidas ruidosas e determinísticas:

| Orçamento | Exemplo para o BoxOffice | Ruído | Como impor |
|---|---|---|---|
| **Latência** a uma taxa moderada fixa | `POST /holds` p95 < 150 ms a 20 reservas/s | Médio–alto em runners de CI compartilhados | Thresholds do k6 com margem + comparação com a linha de base da `main` |
| **Taxa de erros** | < 0,1 % | Baixo | Threshold do k6 |
| **Consultas por requisição** | `GET /orders/{id}`: ≤ 3 statements SQL | Nenhum (determinístico) | Teste de integração que conta statements (pega N+1 com confiabilidade) |
| **Tamanho do payload** | JSON do mapa de assentos ≤ 60 KB | Nenhum | Teste de contrato |
| **Alocações / CPU por requisição** | ≤ linha de base + 10 % | Baixo (com JMH ou um profiler) | Job de micro-benchmark |
| **Tamanho da imagem e tempo de início** | Imagem ≤ 250 MB; pronta em ≤ 30 s | Baixo | Passo do pipeline sobre a imagem construída |

O orçamento do k6 é um teste curto, de modelo aberto, contra uma stack parecida com a produção iniciada dentro do job. Não é um teste de capacidade — runners de CI são pequenos e ruidosos —, mas pega com confiabilidade as grandes regressões: um índice ausente, um N+1, uma chamada síncrona adicionada ao caminho quente.

```javascript title="k6/budget.js"
import { textSummary } from 'https://jslib.k6.io/k6-summary/0.0.2/index.js';
import { browse, hold } from './lib/boxoffice.js';
export { browse, hold };

export const options = {
  scenarios: {
    browse: { executor: 'constant-arrival-rate', exec: 'browse', rate: 100, timeUnit: '1s',
              duration: '3m', preAllocatedVUs: 50, maxVUs: 200 },
    hold:   { executor: 'constant-arrival-rate', exec: 'hold', rate: 20, timeUnit: '1s',
              duration: '3m', preAllocatedVUs: 100, maxVUs: 300 },
  },
  thresholds: {
    'http_req_duration{name:GET /events/{id}}': ['p(95)<80'],
    'http_req_duration{name:POST /holds}':      ['p(95)<150'],
    http_req_failed: ['rate<0.001'],
    dropped_iterations: ['count==0'],
  },
};

export function handleSummary(data) {
  return {
    stdout: textSummary(data, { indent: ' ', enableColors: false }),
    'results/summary.json': JSON.stringify(data),
  };
}
```

```yaml title=".github/workflows/perf-budget.yaml"
name: perf-budget
on:
  pull_request:
  push: { branches: [ main ] }        # main's runs become the baseline

jobs:
  k6:
    runs-on: ubuntu-latest
    permissions: { contents: read, actions: read }
    steps:
      - uses: actions/checkout@v4
      - name: Start BoxOffice with production-like settings
        run: docker compose -f compose.yaml -f compose.perf.yaml up -d --build --wait
      - name: Seed a 60 000-seat event
        run: docker compose exec -T db psql -U postgres -d boxoffice -f /seed/onsale.sql
      - uses: grafana/setup-k6-action@v1
      - name: Warm up (not measured)
        run: k6 run --quiet -e BASE_URL=http://localhost:8080 --vus 5 --duration 30s k6/smoke.js
      - name: Performance budget (fails on threshold breach)
        run: mkdir -p results && k6 run -e BASE_URL=http://localhost:8080 k6/budget.js
      - name: Compare with the latest baseline from main
        if: github.event_name == 'pull_request'
        env: { GH_TOKEN: "${{ github.token }}" }
        run: |
          id=$(gh run list --workflow perf-budget --branch main --status success --limit 1 \
                 --json databaseId -q '.[0].databaseId')
          gh run download "$id" --name k6-summary --dir baseline || echo "no baseline yet"
          python3 k6/compare.py results/summary.json baseline/summary.json --max-regression 0.15
      - uses: actions/upload-artifact@v4
        if: always()
        with: { name: k6-summary, path: results/summary.json }
```

```python title="k6/compare.py"
import argparse
import json
import os
import sys

parser = argparse.ArgumentParser(description="Compare k6 p95 per endpoint with a baseline")
parser.add_argument("current")
parser.add_argument("baseline")
parser.add_argument("--max-regression", type=float, default=0.15)
args = parser.parse_args()


def p95_by_endpoint(path):
    metrics = json.load(open(path))["metrics"]
    return {name: m["values"]["p(95)"] for name, m in metrics.items()
            if name.startswith("http_req_duration{name:")}


current = p95_by_endpoint(args.current)
baseline = p95_by_endpoint(args.baseline) if os.path.exists(args.baseline) else {}
failed = False
for name, value in sorted(current.items()):
    ref = baseline.get(name)
    if ref is None:
        print(f"{name}: {value:.1f} ms (no baseline)")
        continue
    change = (value - ref) / ref
    regression = change > args.max_regression
    failed |= regression
    print(f"{name}: {ref:.1f} -> {value:.1f} ms ({change:+.0%}){'  REGRESSION' if regression else ''}")
sys.exit(1 if failed else 0)
```

Dois gates protegem o orçamento: os thresholds **absolutos** em `budget.js` (derivados dos SLOs, com margem para o runner pequeno) e a comparação **relativa** com a `main` (uma desaceleração de 15 % falha mesmo que o threshold absoluto ainda passe). Para manter o gate confiável em vez de ignorado:

- **Combata o ruído**: taxa de chegada fixa, passo de aquecimento, o mesmo tipo de runner, e uma repetição automática antes de falhar; um runner self-hosted dedicado reduz ainda mais a variância.
- **Prefira orçamentos determinísticos** quando possível: uma asserção de contagem de consultas em um teste de integração nunca é instável e pega a regressão mais comum (N+1).
- **Torne as falhas acionáveis**: publique o resumo, aponte o trace da requisição mais lenta e diga qual endpoint regrediu e quanto.
- **Rode a campanha completa em outro lugar**: o gate do PR é um alarme de fumaça; os testes load, spike e breakpoint rodam todas as noites ou antes de grandes eventos no ambiente de desempenho. O [Hands-on 11](../../../hands-on/11/index.md) conecta esse gate ao pipeline do BoxOffice.

!!! tip "Na entrevista"

    Feche a parte de capacidade de um design com um cálculo explícito: "Pico de 4 500 reservas/s; um pod sustenta ~275 dentro do SLO; a 75 % do joelho são 22 pods, 33 para sobreviver à perda de uma zona; as conexões pela Lei de Little são 4 500 × 6 ms ≈ 27 ativas, então PgBouncer na frente do primário; o autoscaling leva minutos, então pré-escalamos às 09:45 e a sala de espera admite no máximo o que o banco aguenta." Poucos candidatos conectam **joelho medido → réplicas → folga → controle de admissão**; fazer isso de uma vez é um sinal forte.

!!! warning "Armadilhas"

    - **Planejar com a vazão máxima em vez do joelho**: o sistema "aguenta" essa taxa com o SLO quebrado.
    - **Esquecer os recursos compartilhados**: 30 pods a mais são 300 conexões de banco a mais.
    - **Confiar no autoscaling reativo para um pico conhecido**: o atraso é maior que os minutos críticos do pico.
    - **Folga que some em uma falha**: calcule a capacidade *depois* de perder uma zona, não antes.
    - **Um gate de desempenho instável**: se ele falha ao acaso, as pessoas aprendem a rodá-lo de novo até ficar verde — reduza o ruído e prefira orçamentos determinísticos.
    - **Nunca medir de novo**: o joelho se move a cada release; o plano de capacidade de ontem é uma hipótese.

---

## Como se conecta { #how-it-connects }

``` mermaid
flowchart LR
    KNEE["measured knee per pod<br/>← Load testing"] --> REP["replicas = peak ÷<br/>(knee × target utilization)"]
    LL["Little's Law<br/>N = X × R"] --> CONN["threads, connections,<br/>PgBouncer"]
    REP --> HEAD["headroom:<br/>zone loss, 75 % of the knee"]
    HEAD --> LAG["autoscaling lag, cold starts<br/>→ pre-scale before 10:00"]
    LAG --> WR["waiting room admits what<br/>the database can take"]
    REP --> COST["pods → nodes → dollars<br/>→ Cloud-native FinOps"]
    FC["forecast and<br/>capacity review"] --> REP
    BUD["performance budget in CI<br/>guards the knee"] --> KNEE
```

**Componentes da paleta:** [`app`](../../../reference/components/compute/index.md#app) (réplicas por serviço) · [`sql`](../../../reference/components/storage/index.md#sql) (conexões e o limite do primário) · [`queue`](../../../reference/components/messaging/index.md#queue) (a taxa de admissão da sala de espera) · [`serverless`](../../../reference/components/compute/index.md#serverless) (cold starts e limites de concorrência) · [`metrics`](../../../reference/components/observability/index.md#metrics) (utilização, o sinal do autoscaler). **Cenários:** `serverless-burst`, `scale-out`, `flash-sale`. **Continua em:** [Estimativas — filas](../../estimation/queueing/index.md), [Compute — serverless e autoscaling](../../compute/serverless-autoscaling/index.md), [Cloud-native — Kubernetes](../../cloud-native/kubernetes/index.md), [Cloud-native — FinOps](../../cloud-native/finops/index.md), [Estudo de caso — ingressos](../../case-studies/ticketing/index.md).

---

[^1]: LITTLE, J. D. C. A Proof for the Queuing Formula: L = λW. *Operations Research*, v. 9, n. 3, p. 383–387, 1961.
[^2]: ALLSPAW, J.; KEJARIWAL, A. *The Art of Capacity Planning: Scaling Web Resources in the Cloud*. 2nd ed. O'Reilly, 2017.
[^3]: BEYER, B. et al. [Site Reliability Engineering](https://sre.google/sre-book/handling-overload/){target="_blank"}, cap. 21 "Handling Overload". O'Reilly, 2016.
[^4]: Grafana Labs. [Automated performance testing](https://grafana.com/docs/k6/latest/testing-guides/automated-performance-testing/){target="_blank"}. Documentação do k6.
