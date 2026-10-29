# 3. Autoscaling

O lab 3 escalou o `catalog` à mão: três réplicas atrás do Nginx, qualquer que fosse a carga. O
**Horizontal Pod Autoscaler** (HPA) fecha o laço — mede, compara com um alvo e muda o número de
réplicas —: é o laço de controle de [autoscaling](../../../classes/compute/serverless-autoscaling/index.md)
da aula de computação, rodando a cada 15 segundos.

## A regra { #the-rule }

``` yaml title="k8s/base/catalog-hpa.yaml"
--8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog-hpa.yaml"
```

A fórmula central do HPA é simples:

$$
\text{réplicas desejadas} = \left\lceil \text{réplicas atuais} \times \frac{\text{utilização atual}}{\text{utilização alvo}} \right\rceil
$$

Com 2 pods a 150% do seu request de CPU e um alvo de 60%: ⌈2 × 150 / 60⌉ = 5 pods. A utilização é uma
porcentagem do **request** (250m), não do nó: um pod usando 150m está a 60%.

| Campo do `behavior` | Por que existe |
|---|---|
| `scaleUp.stabilizationWindowSeconds: 0` | escalar para cima assim que a carga aparece — scale-up lento é requisição perdida |
| `scaleUp.policies` (100% ou +2 pods a cada 15 s) | crescimento limitado: no máximo dobra por período, então uma leitura ruidosa não explode o deployment |
| `scaleDown.stabilizationWindowSeconds: 120` | usa a recomendação *mais alta* dos últimos 2 min — sem oscilação quando a carga oscila |
| `scaleDown.policies` (1 pod a cada 30 s) | libera capacidade devagar; escalar para baixo rápido demais dispara o scale-up de novo |

??? question "Por que CPU, e quando ela é o sinal errado?"

    O `catalog` é limitado por CPU quando a taxa de acerto do cache é alta: mais requisições → mais
    CPU, quase linearmente, então a CPU é um bom indicador da carga. Ela é o sinal errado quando o
    gargalo está em outro lugar: um serviço esperando um banco de dados (CPU baixa, latência alta), um
    consumidor Kafka (escale pelo **lag**), um servidor WebSocket (escale por conexões). Para esses, o
    HPA aceita métricas customizadas e externas (requisições por segundo, tamanho de fila) por meio de
    um adaptador como o KEDA ou o Prometheus adapter.

## Coloque carga { #load-it }

O script do k6 sobe a **taxa de chegada** em rampa (modelo aberto) pelo Ingress, segura e desce de
volta. O observador registra o que o HPA vê e decide a cada 5 segundos.

=== "load/catalog-hpa.js"

    ``` javascript title="load/catalog-hpa.js"
    --8<-- "docs/2027.1/hands-on/10/code/load/catalog-hpa.js"
    ```

=== "scripts/watch-hpa.sh"

    ``` shell title="scripts/watch-hpa.sh"
    --8<-- "docs/2027.1/hands-on/10/code/scripts/watch-hpa.sh"
    ```

Três terminais:

``` shell
mkdir -p results && sh scripts/watch-hpa.sh | tee results/lab10-hpa.csv   # 1: the control loop
kubectl -n boxoffice get pods -l app=catalog -w            # 2: pods appearing
k6 run -e PEAK=250 load/catalog-hpa.js                     # 3: the load (≈ 11 min)
```

Ajuste o `PEAK` à sua máquina: ele deve ficar claramente acima do que dois pods conseguem servir (o
lab 2 deu esse número a você), mas abaixo do que o laptop inteiro consegue servir.

!!! example "Forma esperada (ilustrativa)"

    A CPU sobe durante a rampa; o HPA adiciona pods em degraus (2 → 4 → 6 …) tão rápido quanto a
    política de `scaleUp` permite; **cada pod novo precisa de dezenas de segundos antes de ficar
    pronto** (inicialização da JVM + probes), então o p95 sobe durante a rampa e volta a cair durante o
    patamar. Depois que a carga cai, as réplicas ficam de pé durante a janela de estabilização de 2
    minutos e então saem uma a uma.

    O atraso entre "a carga chega" e "a capacidade está pronta" é o preço do autoscaling reativo. Para
    uma venda relâmpago com horário conhecido, você faria **pré-escalonamento** (aumentar o
    `minReplicas` antes das 10:00) em vez de torcer para o HPA ser rápido o bastante — o escalonamento
    reativo cuida do inesperado, o agendamento cuida do esperado.

## Armadilhas { #pitfalls }

- **Sem requests, sem HPA.** A utilização é relativa a `resources.requests.cpu`; sem requests o HPA
  reporta `<unknown>` e não faz nada.
- **O aquecimento da JVM parece carga.** Uma JVM iniciando queima CPU (carregamento de classes, JIT):
  pods novos podem empurrar a média para cima e disparar *mais* scale-up. A startup probe mantém os
  pods não prontos fora do tráfego, mas a CPU deles ainda conta; a janela de estabilização e a
  política de scale-up limitam o estrago.
- **O banco de dados não escala sozinho.** Oito pods do `catalog` × 10 conexões = 80 conexões a um
  único PostgreSQL. Escalar a camada stateless leva o gargalo para a stateful — confira o
  `max_connections` (ou use o PgBouncer do [lab 6](../../6/index.md)).
- **Capacidade dos nós.** Se os pods pedidos não cabem nos nós, eles ficam em `Pending`. Na nuvem um
  **cluster autoscaler** (ou o Karpenter) adiciona nós, o que leva minutos, não segundos.

[Próximo: Ingress](../ingress/index.md){ .md-button .md-button--primary }
