
O painel da BoxOffice diz que o endpoint do mapa de lugares tem **latência média de 55 ms**. Todos estão contentes — menos os fãs, que reclamam nas redes sociais que o mapa de lugares "demora uma eternidade" durante as aberturas de vendas. Os dois lados têm razão. A média é 55 ms; mas uma requisição em cada cem leva mais de meio segundo, e um fã que abre o mapa de lugares, atualiza, amplia dois setores e tenta três reservas faz requisições suficientes para cair numa dessas lentas quase toda visita. Esta página trata das requisições lentas: como medi-las, por que importam mais do que a média sugere e por que ficam **piores** à medida que os sistemas ficam mais distribuídos.

---

## Por que médias mentem { #why-averages-lie }

Distribuições de latência não são curvas de sino. A maioria das requisições é rápida e parecida; uma minoria — que pega um cache miss, uma pausa de coleta de lixo, um lock, uma nova tentativa, uma conexão fria — é muito mais lenta. O resultado é uma **cauda longa** à direita. O gráfico mostra uma distribuição sintética, mas realista, para 100.000 requisições: 97% são "normais" (em torno de 40 ms) e 3% pegam um caminho lento (em torno de 400 ms):

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})

rng = np.random.default_rng(42)
fast = rng.lognormal(mean=np.log(40), sigma=0.35, size=97_000)   # normal requests
slow = rng.lognormal(mean=np.log(400), sigma=0.6, size=3_000)    # cache misses, GC pauses, retries
ms = np.concatenate([fast, slow])

marks = [("p50", np.percentile(ms, 50), "#10b981", "right"),
         ("mean", ms.mean(), "#a855f7", "left"),
         ("p99", np.percentile(ms, 99), "#f59e0b", "left"),
         ("p99.9", np.percentile(ms, 99.9), "#ef4444", "left")]

fig, ax = plt.subplots(figsize=(8, 4.2))
ax.hist(ms, bins=np.logspace(np.log10(10), np.log10(5000), 120), color="#3b82f6", alpha=0.7)
ax.set_xscale("log")
ax.set_yscale("log")
for i, (name, value, color, side) in enumerate(marks):
    ax.axvline(value, color=color, lw=2)
    x = value * (0.94 if side == "right" else 1.06)
    ax.text(x, 10 ** (3.9 - 0.5 * i), f"{name} = {value:.0f} ms", color=color,
            fontweight="bold", ha=side)
ax.set_xlabel("ms (log)")
ax.set_ylabel("requests (log)")
ax.grid(alpha=0.2)
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

A **média** (cerca de 55 ms) não descreve nenhuma requisição real: ela é puxada para cima pela cauda e, ainda assim, esconde quão ruim a cauda é. A **mediana** diz o que uma requisição típica experimenta. O **p99** e o **p99.9** dizem o que as requisições azaradas experimentam — e são cerca de 12× e 28× mais lentas que a mediana (≈ 510 ms e ≈ 1,1 s contra ≈ 40 ms). Um painel que mostra só a média jamais revelaria isso.

---

## Percentis { #percentiles }

O **p-ésimo percentil** (escrito pXX) de um conjunto de latências é o valor abaixo do qual ficam XX% delas[^1]:

| Percentil | Significado | Também chamado | O que diz |
|---|---|---|---|
| **p50** | metade das requisições é mais rápida | mediana | a experiência típica |
| **p90**, **p95** | 90% / 95% são mais rápidas | — | a experiência "meio lenta" comum |
| **p99** | 99% são mais rápidas; 1 em 100 é mais lenta | cauda de "dois noves" | a experiência dos azarados — e dos usuários intensos |
| **p99.9** | 1 em 1.000 é mais lenta | cauda de "três noves" | rara, mas real; domina quando as requisições fazem fan-out |
| **max** | a mais lenta observada | p100 | casos extremos; ruidoso, mas vale uma olhada |

Para calcular um percentil exatamente, ordene os valores e pegue o da posição ⌈p × n⌉ (o método do *posto mais próximo*): com 1.000 requisições, o p99 é a 990ª mais rápida. Em produção, os sistemas não guardam cada latência; eles registram **histogramas** — contagens de requisições por faixa de latência (0–5 ms, 5–10 ms, …) — e estimam os percentis a partir das faixas. Histogramas do Prometheus, o HdrHistogram e os histogramas exponenciais do OpenTelemetry funcionam assim ([aula 9](../../observability/index.md)).

!!! warning "Não se tira média de percentis"

    Se o servidor A tem p99 = 100 ms e o servidor B tem p99 = 1.000 ms, o p99 do conjunto **não** é 550 ms; ele depende de quantas requisições cada um atendeu e da forma das duas distribuições. O mesmo vale ao longo do tempo: a média de 60 valores de p99 por minuto não é o p99 da hora. Para agregar, **some os histogramas** (some as contagens das faixas) e calcule o percentil a partir do histograma combinado. Painéis que tiram média de percentis estão entre os erros mais comuns — e mais enganosos — de monitoramento.

### Por que a cauda importa mais do que "1%" sugere { #why-the-tail-matters-more-than-1-suggests }

1. **Usuários fazem muitas requisições.** Uma visita de um fã durante uma abertura de vendas (página do evento, mapa de lugares, atualizações, reservas, pagamento, confirmação) envolve facilmente **50 requisições**. A probabilidade de que *pelo menos uma* seja mais lenta que o p99 é $1 - 0.99^{50} \approx 39\%$. A "cauda de 1%" é sentida por **quatro em cada dez visitas**.
2. **Os usuários mais lentos costumam ser os melhores clientes.** Fãs com muitos pedidos, organizadores com eventos grandes, contas com muitos dados — suas requisições fazem mais trabalho e caem na cauda. A Amazon ficou famosa por definir suas metas internas de latência no **p99.9** por esse motivo[^2].
3. **A cauda é onde a sobrecarga começa.** Como mostram as curvas de [filas](../queueing/index.md), o p99 sobe muito antes da média quando um componente se aproxima da saturação. É o aviso mais precoce que você recebe.

---

## Amplificação da cauda sob fan-out { #tail-amplification-under-fan-out }

Backends modernos raramente respondem a uma requisição com uma única chamada. A página do mapa de lugares da BoxOffice chama `inventory` (disponibilidade), `catalog` (layout do local e preços), `order` (os ingressos que o fã já tem) e um serviço de recomendações, em paralelo; o serviço de busca consulta **20 shards de índice** em paralelo e combina os resultados. Uma requisição que faz **fan-out** para N backends em paralelo é tão lenta quanto o **mais lento** deles.

Se cada chamada a um backend é lenta (acima do seu p99) com probabilidade q = 1%, de forma independente, a probabilidade de que a requisição do usuário espere por pelo menos uma chamada lenta é:

$$
P(\text{requisição do usuário lenta}) = 1 - (1 - q)^N
$$

| Fan-out N | q = 1% (p99 do backend) | q = 0,1% (p99.9 do backend) |
|---|---|---|
| 1 | 1% | 0,1% |
| 5 | 4,9% | 0,5% |
| 20 | 18% | 2% |
| 100 | **63%** | 9,5% |
| 500 | 99% | 39% |

```python exec="1" html="1"
from io import StringIO

import matplotlib.pyplot as plt
import numpy as np

plt.rcParams.update({"text.color": "#888", "axes.labelcolor": "#888", "axes.edgecolor": "#888",
                     "xtick.color": "#888", "ytick.color": "#888", "font.size": 10})

n = np.arange(1, 501)
fig, ax = plt.subplots(figsize=(8, 4.2))
for q, label, color in [(0.01, "q = 1% (p99)", "#ef4444"),
                        (0.001, "q = 0.1% (p99.9)", "#3b82f6"),
                        (0.0001, "q = 0.01% (p99.99)", "#10b981")]:
    ax.plot(n, 100 * (1 - (1 - q) ** n), color=color, lw=2.5, label=label)
for x in (10, 100):
    y = 100 * (1 - 0.99 ** x)
    ax.plot(x, y, "o", color="#ef4444")
    ax.annotate(f"N = {x}: {y:.0f}%", xy=(x, y), xytext=(x * 0.35, y + 9), color="#ef4444")
ax.set_xscale("log")
ax.set_xlim(1, 500)
ax.set_ylim(0, 100)
ax.set_xlabel("N (log)")
ax.set_ylabel("1 − (1 − q)ᴺ  (%)")
ax.grid(alpha=0.2)
ax.legend(frameon=False, loc="upper left")
for side in ("top", "right"):
    ax.spines[side].set_visible(False)
plt.tight_layout()
buf = StringIO()
plt.savefig(buf, format="svg", transparent=True)
print(buf.getvalue())
plt.close()
```

Essa é a observação central de *The Tail at Scale*, de Dean e Barroso[^3]: com fan-out de 100, um backend cujo p99 é 1 segundo faz **63% das requisições dos usuários** levarem mais de 1 segundo. Num grande sistema distribuído, **a cauda do backend vira a mediana do usuário**. Quanto mais você divide um sistema em pedaços paralelos (shards, microsserviços), mais a lentidão rara de cada pedaço passa a dominar.

!!! example "BoxOffice — busca em 20 shards"

    O serviço de busca divide o índice de eventos em 20 shards para manter cada um pequeno e rápido. Cada shard responde em 15 ms no p50 e 120 ms no p99 (um merge ou um cache miss de vez em quando). A busca do usuário espera pelos 20:

    - P(pelo menos um shard acima de 120 ms) = 1 − 0,99²⁰ ≈ **18%** — então o **p82 visto pelo usuário** já é ≥ 120 ms, e o p99 visto pelo usuário é determinado pelo p99.9 dos shards, ou pior.
    - Reduzir os shards pela metade, para 10, corta essa probabilidade para ~10%, mas deixa cada shard maior e mais lento. Manter 20 shards e usar **hedging** (abaixo) costuma ser a troca melhor.

---

## De onde vem a cauda { #where-the-tail-comes-from }

A latência de cauda raramente é causada pelo caminho "normal" do código. Causas típicas[^3]:

| Fonte | Exemplo | Mitigação |
|---|---|---|
| **Filas** | uma rajada chega enquanto um servidor está ocupado | folga (utilização menor), balanceamento pelo menos carregado |
| **Recursos compartilhados** | vizinhos barulhentos no mesmo host, disco ou rede | isolamento, capacidade dedicada para caminhos críticos |
| **Coleta de lixo** | uma JVM pausa por 200 ms | ajuste do GC, coletores de pausa curta, heaps menores |
| **Trabalho em segundo plano** | compactação do banco, rotação de logs, backups | agendar fora do pico, limitar a taxa das tarefas em segundo plano |
| **Cache misses** | cache frio depois de um deploy; chaves raras | pré-aquecimento, cache maior, coalescência de requisições |
| **Novas tentativas e timeouts** | a primeira tentativa estoura o timeout em 1 s, a nova tentativa funciona | timeouts bem ajustados, hedging em vez de esperar |
| **Partidas a frio** | um contêiner ou função serverless novo inicializa | pools aquecidos, concorrência provisionada |
| **Dependências lentas** | o provedor de pagamentos tem um minuto ruim | timeouts, circuit breakers, processamento assíncrono |

---

## Domando a cauda { #taming-the-tail }

Você não consegue eliminar a variabilidade; consegue projetar para que ela não chegue ao usuário.

- **Hedged requests**: envie a requisição a uma réplica; se ela não responder dentro de, digamos, a latência **p95**, envie uma segunda cópia a outra réplica e use a que responder primeiro. Só ~5% das requisições são duplicadas, mas a cauda encolhe drasticamente. Dean e Barroso relatam um caso do Google em que fazer hedging após 10 ms reduziu o p99.9 de uma leitura de 1.000 chaves de 1.800 ms para 74 ms, com apenas 2% mais requisições[^3]. Faça hedging só de leituras **idempotentes**.
- **Tied requests**: envie para duas réplicas ao mesmo tempo, cada uma sabendo da outra; a primeira a *começar* o processamento cancela a outra. Remove a variabilidade de fila ao custo de um pouco de coordenação.
- **Reduza o fan-out**: menos partições, e maiores, para caminhos críticos em latência; pré-calcule agregados (um resumo materializado do mapa de lugares em vez de chamar cinco serviços).
- **Degrade com elegância**: dê a cada backend um prazo e devolva uma resposta **parcial** — o mapa de lugares sem o painel de recomendações ainda é um mapa de lugares.
- **Tire trabalho do caminho crítico**: o que não precisa terminar antes da resposta (e-mails, analytics, indexação de busca) vai para uma fila.
- **Mantenha a utilização baixa** nos componentes críticos em latência e **isole-os** do trabalho em lote.

### Orçamentos de latência { #latency-budgets }

Uma meta voltada ao usuário precisa ser dividida entre os componentes do caminho. Para o checkout da BoxOffice (p99 < 1,5 s):

| Etapa | Orçamento (p99) | Observações |
|---|---|---|
| Borda (CDN, WAF, gateway) | 50 ms | terminação TLS perto do usuário |
| Lógica do serviço `order` | 50 ms | validação, checagem de idempotência |
| `inventory` (confirmar reserva) | 100 ms | uma transação no primário |
| `payment` → provedor | 1.000 ms | o provedor domina; timeout em 1,2 s |
| Gravar pedido + outbox | 50 ms | uma transação |
| Margem | 250 ms | variação da rede, novas tentativas |
| **Total** | **1.500 ms** | — |

Somar p99s é pessimista (raramente todos acontecem na mesma requisição), e é exatamente o que você quer num orçamento. Quando uma etapa estoura seu orçamento, você sabe de quem é o problema. Cada orçamento também define o **timeout** daquele componente — um timeout maior que o orçamento inteiro de quem chama não protege nada.

---

## Medindo percentis com honestidade { #measuring-percentiles-honestly }

Duas armadilhas fazem a latência de cauda parecer melhor do que é:

- **Omissão coordenada** (*coordinated omission*): um gerador de carga que só envia a próxima requisição depois que a anterior volta *para de enviar* quando o servidor trava — então ele nunca registra as requisições que *teriam* chegado durante a trava, e a cauda some dos resultados. Use ferramentas que mantêm uma taxa de chegada constante (modelo aberto: o `constant-arrival-rate` do k6, wrk2) e compare os horários de envio pretendidos e reais[^4]. A [aula 15](../../performance/index.md) aprofunda o tema.
- **Medir no lugar errado**: o próprio cronômetro do servidor não vê o tempo na fila de aceitação, no load balancer e na rede. Meça onde o usuário está (no cliente, ou na borda) e compare com os números do lado do servidor.

!!! example "No código do BoxOffice: percentis no teste de carga (lab 2)"

    O teste de carga do [Hands-on 2](../../../hands-on/2/index.md) evita as duas armadilhas. Ele usa o executor `constant-arrival-rate` do k6 (um modelo **aberto**: novas requisições continuam chegando a `RATE` por segundo, por mais lento que o serviço fique), mede no cliente e escreve seus critérios de aprovação como **percentis por endpoint**, porque uma página de detalhes rápida e uma listagem por cidade lenta, juntas numa média, não descrevem nenhuma das duas. A execução de exemplo do laboratório mostra por que a cauda é o número a observar: em 400 req/s a mediana foi 1,5 ms enquanto o p99 foi 224 ms — a média teria escondido que um fã em cada cem esperou 150 vezes mais que o típico.

    ``` { .javascript title="load/load.js (open model, percentile thresholds)" }
    --8<-- "docs/2027.1/hands-on/2/code/load/load.js:14:31"
    ```

**Experimente:** no cenário scale-out, rode o perfil `load` e anote o p50 e o p99. Depois use `chaos` em `low` para deixar uma réplica lenta de vez em quando. Qual percentil se move primeiro? Quanto o p99 se move em comparação com o p50?

<div class="sdp" data-scenario="scale-out" data-mode="compact" data-profile="load" data-chaos="low" data-height="500"></div>

??? question "Pense antes: SLO para o mapa de lugares"

    A BoxOffice quer um SLO para o endpoint do mapa de lugares. Opção A: "latência média < 100 ms". Opção B: "99% das requisições < 300 ms, medido no gateway ao longo de 28 dias". Qual, e por quê?

    **Resposta**: **B**. Ela é expressa como percentil (restringe a cauda, que os usuários sentem), tem um limiar que importa para os usuários, um ponto de medição (o gateway, mais perto do usuário que o serviço) e uma janela. A opção A pode ser cumprida enquanto 3% das requisições levam mais de um segundo — exatamente a reclamação nas redes sociais. SLOs são desenvolvidos na [aula 9](../../observability/slo/index.md).

!!! tip "Na entrevista"

    Sempre expresse metas de latência como **percentis** ("p99 < 200 ms para leituras") e, quando o seu design fizer fan-out (busca particionada, uma página que agrega vários serviços, scatter-gather), mencione a **amplificação da cauda** e uma mitigação: "com 20 shards, o shard mais lento domina, então eu acrescentaria hedged requests depois do p95 e devolveria resultados parciais depois de um prazo." Isso mostra que você entende como sistemas distribuídos se comportam, não só como são desenhados.

!!! success "Boas práticas"

    - **Exporte a latência como histograma com limites de faixa nos thresholds do SLO** — com uma borda de faixa em 300 ms, "p99 < 300 ms" é calculado com exatidão em vez de interpolado.
    - **Rotule a latência por rota, nunca um número por serviço** — uma página de detalhes rápida e uma listagem lenta precisam de percentis separados. Na BoxOffice: os rótulos `name:detail` e `name:list` no `load/load.js` do lab 2 (quadro acima).
    - **Informe p50, p99 e p99,9 junto com o número de requisições** — um p99 sobre 200 requisições é a segunda mais lenta; ele precisa de milhares para significar algo.
    - **Derive todo timeout de um orçamento de latência, e propague o prazo restante** — uma chamada recebe no máximo sua parte do orçamento de quem chama, para que quem chama nunca estoure antes e repita um trabalho ainda em andamento.
    - **Faça hedging só de leituras idempotentes, depois do p95, com um teto de carga extra** (alguns por cento) — o hedging compra latência de cauda com carga, e a carga precisa ficar limitada.

!!! warning "Armadilhas comuns"

    - **Reportar médias** de latência — ou SLOs sobre médias.
    - **Tirar média de percentis** entre servidores ou janelas de tempo em vez de somar histogramas.
    - **Ignorar o fan-out**: o p99 do backend não é o p99 do usuário quando uma requisição faz muitas chamadas.
    - **Fazer hedging de requisições não idempotentes**: duplicar um `POST /orders` duplica o pedido.
    - **Omissão coordenada** nos testes de carga: a cauda que você não mede é a cauda que você não corrige.

---

## Como se conecta { #how-it-connects }

``` diagram
flowchart LR
    DIST["latência de cauda longa"] --> PCT["p50, p99, p99.9<br/>a partir de histogramas"]
    PCT --> SLO["SLOs de latência<br/>→ Confiabilidade"]
    PCT --> OBS["combinar histogramas,<br/>nunca tirar média → Observabilidade"]
    FAN["fan-out N<br/>1 − (1 − q)ᴺ"] --> AMP["a cauda do backend vira<br/>o caso comum (N grande)"]
    DIST --> SRC["fontes: GC, cache misses,<br/>cold starts, dependências lentas"]
    AMP --> TAME["hedging, resultados parciais,<br/>menos fan-out, folga"]
    SRC --> TAME
    TAME --> BUD["orçamentos de latência<br/>e timeouts → Confiabilidade"]
    PCT --> CO["medir no cliente,<br/>omissão coordenada → Performance"]
```

**Componentes da paleta:** [`search`](../../../reference/components/compute/index.md#search) (20 shards: a cauda do fan-out) · [`app`](../../../reference/components/compute/index.md#app) (uma página que agrega vários serviços; hedging para outra réplica) · [`cache`](../../../reference/components/storage/index.md#cache) (misses são uma fonte de cauda) · [`serverless`](../../../reference/components/compute/index.md#serverless) (cold starts) · [`apigw`](../../../reference/components/edge/index.md#apigw) (onde o SLO é medido) · [`payment`](../../../reference/components/external/index.md#payment) (o provedor domina o orçamento do checkout) · [`metrics`](../../../reference/components/observability/index.md#metrics) (histogramas, nunca média de percentis). **Cenários:** `scale-out` (com `chaos`), `search-autocomplete`. **Continua em:** [Matemática da Disponibilidade](../availability-math/index.md), [Observabilidade — SLOs](../../observability/slo/index.md), [Confiabilidade — timeouts](../../reliability/patterns/index.md#timeout), [Observabilidade — sinais](../../observability/signals/index.md), [Performance — testes de carga](../../performance/load-testing/index.md), [Hands-on 2](../../../hands-on/2/index.md).

## Pontos-chave { #key-takeaways }

!!! takeaways ""

    - Distribuições de latência têm **caudas longas**; a média as esconde — use **p50, p99, p99.9**.
    - Percentis vêm de **histogramas**; agregue somando histogramas, **nunca tirando média** de percentis.
    - Usuários e clientes intensos fazem muitas requisições, então a "cauda de 1%" atinge uma grande parte das **visitas**.
    - Sob fan-out N, P(lenta) = **1 − (1 − q)ᴺ**: com 20 chamadas o p99 do backend atinge 18 % das requisições do usuário; a partir de ~70 chamadas, vira a mediana do usuário.
    - Combata a cauda com **hedging, resultados parciais, menos fan-out, folga e trabalho assíncrono**; divida metas ponta a ponta em **orçamentos de latência** com timeouts correspondentes.

---

[^1]: KLEPPMANN, M.; RICCOMINI, C. *Designing Data-Intensive Applications*, 2nd ed. O'Reilly. Chapter 2 (describing performance: response time percentiles and tail latency amplification).
[^2]: DeCANDIA, G. et al. Dynamo: Amazon's Highly Available Key-value Store. *SOSP*, 2007 (service-level agreements expressed at the 99.9th percentile).
[^3]: DEAN, J.; BARROSO, L. A. The Tail at Scale. *Communications of the ACM*, 56(2), 2013, pp. 74–80.
[^4]: TENE, G. *How NOT to Measure Latency*. Talk, Strange Loop, 2015.
