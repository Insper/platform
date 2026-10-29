# 3. Portão de Desempenho { #3-performance-gate }

Testes pegam respostas erradas; não pegam uma mudança que deixa a resposta certa dez vezes mais lenta.
Um **orçamento de desempenho** transforma a latência que você prometeu (o SLO do lab 8, o
[planejamento de capacidade](../../../classes/performance/capacity-planning/index.md#performance-budgets))
numa verificação do build: o CI sobe o serviço, roda um teste k6 curto com thresholds e **reprova o pull
request** quando um threshold é ultrapassado.

## Um ambiente fixo { #a-fixed-environment }

Comparações só fazem sentido se toda execução usa o mesmo ambiente. O CI sobe uma stack pequena e
dedicada — PostgreSQL, Redis e `catalog` com o mesmo limite de CPU do `docker-compose.yaml` — a partir
do seu próprio arquivo Compose:

``` yaml title=".github/ci/compose.perf.yaml"
--8<-- "docs/2027.1/hands-on/11/code/.github/ci/compose.perf.yaml"
```

`docker compose … up --wait` só retorna quando todos os healthchecks passam, então o k6 nunca mede uma
JVM que ainda está subindo.

## O orçamento { #the-budget }

``` javascript title="load/budget.js"
--8<-- "docs/2027.1/hands-on/11/code/load/budget.js"
```

| Escolha | Por quê |
|---|---|
| um cenário `warmup` de 20 s, não medido | a compilação JIT, os pools de conexão e o cache esquentam; os thresholds só valem para `scenario:budget` |
| modelo aberto (`constant-arrival-rate`) | a taxa de chegada não diminui quando o serviço fica lento, como com usuários reais |
| p95 < 300 ms **e** p99 < 800 ms | a requisição típica e a cauda; folgados para um runner, para que só regressões reais reprovem |
| falhas < 1%, checks > 99% | um `500` rápido não é um sucesso |

O job `performance budget` do `ci.yaml` (passo 1) instala o k6 com `grafana/setup-k6-action`, roda o
script com `grafana/run-k6-action` e imprime os logs do serviço se falhar. Um threshold ultrapassado faz
o k6 sair com código 99, e o job falha.

## Rode localmente { #run-it-locally }

``` shell
docker compose -f .github/ci/compose.perf.yaml up -d --build --wait --wait-timeout 300
k6 run load/budget.js
docker compose -f .github/ci/compose.perf.yaml down -v
```

Você deve ver todos os thresholds com `✓`. Uma execução de teste num notebook:

``` text
  █ THRESHOLDS

    checks{scenario:budget}
    ✓ 'rate>0.99' rate=100.00%

    http_req_duration{scenario:budget}
    ✓ 'p(95)<300' p(95)=6.7ms
    ✓ 'p(99)<800' p(99)=9.13ms

    http_req_failed{scenario:budget}
    ✓ 'rate<0.01' rate=0.00%
```

## Quebre-o de propósito { #break-it-on-purpose }

Prove que o portão funciona. Numa nova branch, adicione um atraso artificial ao endpoint de evento de
`services/catalog/src/main/java/boxoffice/catalog/EventController.java` — a primeira linha do método
`get`:

``` java
try { Thread.sleep(400); } catch (InterruptedException e) { Thread.currentThread().interrupt(); }
```

Rode os comandos locais de novo: `p(95)<300` agora mostra `✗` e o k6 termina com
`level=error msg="thresholds on metrics 'http_req_duration{scenario:budget}' have been crossed"`. Faça
push da branch e abra um pull request: o check `performance budget` fica vermelho e o botão de merge o
avisa. Feche o pull request sem fazer merge (e apague a branch) — era só um experimento.

!!! warning "Um portão ruidoso é pior que nenhum portão"

    Runners compartilhados de CI variam de uma execução para outra. Defina thresholds com uma margem de
    segurança sobre os seus números normais (aqui, o p95 é ~7 ms contra um orçamento de 300 ms), mantenha
    o teste curto mas longo o bastante para ter milhares de amostras, e olhe a tendência dos números ao
    longo de muitas execuções antes de apertá-los. Um portão que falha aleatoriamente ensina as pessoas a
    rodar de novo até ficar verde.

[Próximo: GitOps com Argo CD](../gitops/index.md){ .md-button .md-button--primary }
