# 3. Game Day

Os padrões do passo 2 foram testados um de cada vez, por quem os escreveu, sabendo o que ia quebrar.
Incidentes reais não são assim. Um **game day** é um incidente ensaiado: um time injeta falhas num
sistema em funcionamento, *sem contar aos operadores quais*, e verifica duas hipóteses ao mesmo
tempo — que o **sistema** degrada do jeito que o projeto diz, e que as **pessoas** percebem,
diagnosticam e mitigam a tempo. É o lado prático da
[engenharia do caos](../../../classes/reliability/chaos/index.md).

## Papéis (grupos de 3–4) { #roles-groups-of-34 }

| Papel | Faz | Não pode |
|---|---|---|
| **Mestre do jogo** | escolhe e injeta as falhas com o Toxiproxy, controla o relógio | contar aos outros o que foi injetado |
| **Operador(es)** | acompanha o Grafana (lab 8) e os logs, diagnostica, mitiga | olhar o terminal do mestre do jogo |
| **Escriba** | escreve a linha do tempo: cada observação e decisão, com o horário | consertar qualquer coisa |

Troque os papéis entre as rodadas, para que todos operem uma vez.

## Antes de começar { #before-you-start }

1. **Estado estável.** Rode o `load/pay-under-chaos.js` com `DURATION=30m` e anote os valores normais
   do dashboard RED: taxa, % de erros e p95 do `order` e do `payment`. Essa é a linha de base com que
   todo experimento é comparado.
2. **Hipóteses.** Para cada experimento abaixo, o time escreve *antes* de injetar o que espera ver
   (por exemplo, "com o `payment` +2 s, o p95 do `pay` no `order` fica abaixo de 1,5 s e o
   `GET /orders/{id}` não é afetado").
3. **Raio de impacto e aborto.** Só o BoxOffice do seu laptop. Condição de aborto: qualquer coisa fora
   do experimento quebra (por exemplo, erros no `catalog`). O botão de abortar é um comando:
   `curl -s -X POST localhost:8474/reset` (remove todo toxic e reativa todo proxy).
4. **Detecção.** O alerta de burn rate do [lab 8](../../8/slo/index.md) observa só o `catalog`.
   Adicione as mesmas duas regras para o `order` (o arquivo do lab 8 com `catalog` trocado por
   `order`, mostrado abaixo) e rode `docker compose restart otel-lgtm`: **Alerting → Alert rules**
   agora lista quatro regras na pasta *BoxOffice*, todas *Normal*, para que os operadores possam ser
   acionados.

??? example "infra/grafana/alerting/slo-order.yaml — o arquivo completo"

    ``` yaml title="infra/grafana/alerting/slo-order.yaml"
    --8<-- "docs/2027.1/hands-on/9/code/infra/grafana/alerting/slo-order.yaml"
    ```

## Os experimentos { #the-experiments }

O mestre do jogo escolhe três destes, em qualquer ordem, de 5 a 8 minutos cada, com tempo de
recuperação entre eles:

| # | Injeção (mestre do jogo) | O que um bom sistema faz | O que um bom operador faz |
|---|---|---|---|
| 1 | `payment` +2 s de latência | timeouts + breaker: `503`s rápidos no `pay`, `browse` não é afetado | encontra o `payment` no trace, vê o breaker abrir |
| 2 | buraco negro no `psp` (toxic `timeout`, 0) | o timeout de leitura do `payment` (2 s) faz as chamadas falharem; o breaker do `order` abre | segue o trace um salto adiante, até o provedor |
| 3 | 40% de `reset_peer` no `payment` | os retries escondem a maioria dos erros; a taxa de erros sobe só um pouco | percebe os retries nas métricas, não entra em pânico |
| 4 | proxy do `payment` desativado | breaker aberto, `503` rápido, os pedidos ficam em `PENDING_PAYMENT` | comunica "pagamentos fora do ar, pedidos a salvo" |
| 5 | `db` pausado (`docker compose pause db`) | tudo fica lento; o alerta de SLO dispara | identifica a dependência compartilhada, não o sintoma |
| 6 | `bandwidth` de 1 KB/s no `payment` | respostas lentas batem no timeout de leitura | distingue "lento" de "fora do ar" |

Comandos de injeção:

``` shell title="scripts/game-day.sh"
--8<-- "docs/2027.1/hands-on/9/code/scripts/game-day.sh"
```

## Durante a rodada { #during-the-round }

Os operadores trabalham como num incidente real (veja a
[aula de resposta a incidentes](../../../classes/observability/incident-response/index.md)): declaram o
incidente quando um alerta dispara ou um sintoma aparece, designam um incident commander, diagnosticam
pelo caminho dashboard → trace → logs, **mitigam primeiro** (por exemplo, parar de mandar tráfego para
um caminho quebrado, aumentar um timeout, escalar) e investigam depois. O escriba registra os horários
neste formato:

| Horário | Quem | Observação / decisão |
|---|---|---|
| 10:02:10 | MJ | (escondido) experimento 1 injetado |
| 10:04:30 | Op | p95 do `order` subindo no dashboard; nenhum alerta ainda |
| 10:05:05 | Op | o trace mostra o span do `payment` com ~2 s; breaker `OPEN` no actuator |
| … | | |

Da linha do tempo saem os dois números que toda revisão de incidente pede: **tempo para detectar**
(injeção → primeira observação correta) e **tempo para mitigar** (injeção → usuários não mais
afetados).

## Depois: uma revisão sem culpados { #after-a-blameless-review }

Escreva uma revisão por rodada em `results/lab9-gameday.md`. *Sem culpados* (*blameless*) significa
que a revisão explica como o sistema e o processo permitiram o resultado — nunca quem é o culpado.

``` markdown title="results/lab9-gameday.md (template)"
# Game day — round <n>

**Experiment:** <what was injected, when> · **Duration:** <mm:ss>
**Hypothesis:** <what we expected>
**Result:** <confirmed | refuted> — <one sentence>

## Impact
- Users affected: <which requests, how many, for how long> (from the RED dashboard)
- SLO budget spent: <% of the 28-day budget>

## Timeline
| Time | Event |
|---|---|

## Detection and mitigation
- Time to detect: <min> — how: <alert | dashboard | trace>
- Time to mitigate: <min> — how: <...>

## What went well / what was hard

## Action items
| Action | Type (prevent / detect / mitigate) | Owner |
|---|---|---|
```

!!! warning "Armadilhas"

    - **Sem hipótese, não há experimento.** Quebrar coisas para "ver o que acontece" ensina pouco; uma
      hipótese refutada é o resultado valioso.
    - **Comece pequeno.** Latência antes de quedas, uma dependência antes de duas, um laptop antes da
      produção.
    - **O botão de abortar precisa funcionar** antes da primeira injeção. Teste o `reset` primeiro.
    - **Resolva os itens de ação.** Um game day cujas descobertas ficam num documento será repetido,
      com as mesmas descobertas, por um incidente real.

[Próximo: Meça](../measure/index.md){ .md-button .md-button--primary }
