# 3. SLO e Alerta de *Burn Rate*

Um dashboard precisa de alguém olhando para ele. Um **alerta** olha por você — e um alerta ruim te
acorda às 3 da manhã por nada, até você aprender a ignorá-lo. Este passo transforma uma promessa ao
usuário em um alerta que dispara quando, e somente quando, a promessa está em risco. A teoria está na
[aula de alertas](../../../classes/observability/alerting/index.md) e na
[aula de SLO](../../../classes/reliability/slo/index.md).

## Da promessa aos números

| Termo | `catalog` do BoxOffice |
|---|---|
| **SLI** (indicador) | fração das requisições ao `catalog`, sem os *health checks*, **não** respondidas com 5xx |
| **SLO** (objetivo) | 99,5% em 28 dias corridos (a janela padrão do curso: quatro semanas inteiras) |
| **Orçamento de erros** | 0,5% das requisições podem falhar: a 100 req/s, 100 × 86 400 × 28 × 0,005 ≈ **1,21 milhão** de requisições com falha, ou cerca de **202 minutos** de queda total a cada 28 dias |
| ***Burn rate*** (taxa de queima) | quão rápido o orçamento está sendo gasto, relativo a "exatamente no orçamento": `fração de erros / 0,005` |

Uma taxa de queima de **1** gasta o orçamento inteiro em exatamente 28 dias. Uma taxa de **14,4**
gasta cerca de 2,1% dele em uma hora (14,4 × 1 h / 672 h ≈ 2,1%) e todo ele em menos de dois dias. (Os limiares
14,4 e 6 vêm do *SRE workbook* do Google, que os derivou para uma janela de 30 dias: 2% e 5% do orçamento;
com 28 dias eles significam 2,1% e 5,4% — perto o bastante para manter os números padrão.)

??? question "Por que excluir `/actuator/*` do SLI?"

    O Docker, o Kubernetes e a borda chamam os endpoints de saúde a cada poucos segundos, e essas
    chamadas quase nunca falham. Contá-las infla a taxa de sucesso com requisições que nenhum usuário
    fez — o SLI precisa medir o que os **fãs** vivem. O mesmo raciocínio exclui dos SLIs de produção a
    carga sintética que você mesmo gera, a menos que ela seja marcada e filtrada.

## Por que "taxa de erros > 1%" é um alerta ruim

| Alerta | Problema |
|---|---|
| `erros > 1%` por 5 min | dispara num soluço de 5 minutos que custou cerca de 0,01% do orçamento (ruído), e fica calado com uma taxa de erros de 0,8% que queima o orçamento inteiro em 17,5 dias (perdido) |
| `erros > 0` | aciona o tempo todo |
| `p99 > 1 s` em uma instância | mede uma máquina, não usuários |

A resposta do *SRE workbook* do Google é o alerta de **múltiplas janelas e múltiplas taxas de
queima**: acionar quando o orçamento queima rápido em uma janela **longa** (é um problema real, não um
soluço) **e** em uma janela **curta** (ainda está acontecendo — o alerta para logo depois da
recuperação).

| Severidade | Taxa de queima | Janela longa | Janela curta | Orçamento gasto quando dispara |
|---|---|---|---|---|
| página | 14,4 | 1 h | 5 min | ≈ 2,1% |
| página | 6 | 6 h | 30 min | ≈ 5,4% |
| ticket | 1 | 3 dias | 6 h | ≈ 10,7% |

Este lab provisiona a primeira regra como **página** e a segunda como **ticket** (um sinal mais lento
e mais barato para uma equipe menor); a terceira fica como exercício.

## As regras, como código

O Grafana carrega regras de alerta de arquivos YAML na sua pasta de provisionamento (montada no
[passo 1](../instrument/index.md) a partir de `infra/grafana/alerting/`). Cada regra roda as
consultas **A** e **B** — a taxa de queima nas duas janelas — e uma expressão matemática **C**, que é a
condição.

``` yaml title="infra/grafana/alerting/slo-catalog.yaml"
--8<-- "docs/2027.1/hands-on/8/code/infra/grafana/alerting/slo-catalog.yaml"
```

Reinicie o `otel-lgtm` e abra **Alerting → Alert rules**: as duas regras aparecem na pasta
*BoxOffice* como *Normal*.

## Dispare-o

Gere tráfego constante e então quebre o banco de que o `catalog` depende:

<!-- termynal -->

``` shell
> k6 run -e RATE=50 -e DURATION=10m load/catalog-otel.js &
> sleep 60 && docker compose stop db && date +%T
10:12:31
> # watch Alerting → Alert rules: Normal → Pending → Firing
> docker compose start db
```

??? question "Preveja: quanto tempo até a regra de queima rápida disparar?"

    Durante a queda toda requisição ao `catalog` falha, então a taxa de queima curta (5 min) salta
    para cerca de 1 / 0,005 = 200 em um minuto. A janela longa é a lenta: a fração de erros da última
    hora precisa passar de 14,4 × 0,5% = **7,2%**. Com tráfego constante e uma hora de histórico
    saudável, isso leva 0,072 × 60 min ≈ **4,3 minutos** de queda; some o `for: 1m` e até 30 s de
    intervalo de avaliação: **≈ 5–6 minutos** até a página. (Se a stack está de pé há menos de uma
    hora, a janela tem menos histórico saudável e o alerta dispara antes.)

    Esse é o compromisso dos alertas de taxa de queima: uma queda total leva minutos para acionar;
    uma taxa de erros persistente de 4% (taxa de queima 8) é pega pela regra de 6 horas quando a fração
    de 6 horas passa de 6 × 0,5% = 3%, depois de cerca de 6 h × 3/4 = 4,5 horas; e um soluço de 30
    segundos nunca aciona ninguém.

Numa execução de teste deste lab (com menos de uma hora de histórico), a regra ficou *Firing*
**288 s** depois de o `db` parar, com a descrição *"burn rate 18.2 (1 h) and 74.4 (5 min)"*.

Registre nos seus resultados a hora em que parou o `db`, a hora em que a regra ficou *Pending* e
*Firing*, e as taxas de queima mostradas na descrição do alerta.

!!! warning "Armadilhas"

    - **Sem tráfego, sem SLI.** A divisão por zero não produz dados; `noDataState: OK` mantém uma noite
      tranquila tranquila, mas um serviço que não recebe tráfego porque a borda caiu parece "saudável".
      Combine alertas de SLO com uma sonda sintética ou com um alerta de tráfego caindo a zero.
    - **Alerte por sintomas, investigue causas.** CPU, heap e pool são para o dashboard; a página é
      sobre usuários. Um disco cheio que ainda não afeta usuários é um ticket, não uma página.
    - **Toda página precisa de um link de *runbook*** (um `annotations.runbook_url`) dizendo o que
      checar primeiro — veja a [aula de resposta a incidentes](../../../classes/observability/incident-response/index.md).

## Exercício: um SLO de latência

Escreva uma terceira regra para a promessa "95% dos `GET /catalog/events/{id}` terminam em menos de
250 ms". Dica: o SLI é a razão entre a taxa do bucket `le="0.25"` e a taxa de `_count` dessa rota; o
orçamento é 5%. Dispare-a adicionando latência (no [lab 9](../../9/index.md) você vai usar o Toxiproxy
exatamente para isso).

[Próximo: Meça](../measure/index.md){ .md-button .md-button--primary }
