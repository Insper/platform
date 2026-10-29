# 2. Deploy do BoxOffice { #2-deploy-boxoffice }

O Compose descreve *contêineres a iniciar*. Os manifestos do Kubernetes descrevem um **estado
desejado** — "duas réplicas prontas do `catalog`, acessíveis como `catalog:8082`" — e os controllers
trabalham continuamente para que a realidade corresponda a ele: um pod que caiu é substituído, os pods
de um nó morto são reagendados, uma nova imagem entra pod a pod. Este passo escreve esse estado
desejado para o caminho de leitura do BoxOffice: `db`, `redis` e `catalog`.

## Organização: base + overlays { #layout-base-overlays }

Os manifestos ficam em `k8s/` no seu repositório, organizados com o **Kustomize** (embutido no
`kubectl`): uma `base` com tudo o que é igual em todo ambiente, e um **overlay** por ambiente só com o
que muda (tags de imagem, secrets, número de réplicas). O [lab 11](../../11/index.md) adiciona um
overlay para o deploy via GitOps sem tocar na base.

```
k8s/
├── kind.yaml                      # the cluster (step 1)
├── base/
│   ├── kustomization.yaml
│   ├── namespace.yaml
│   ├── config.yaml                # ConfigMap: DB_HOST, REDIS_HOST, ...
│   ├── db.yaml                    # PostgreSQL StatefulSet + headless Service
│   ├── redis.yaml
│   ├── catalog.yaml               # Deployment + Service
│   ├── catalog-hpa.yaml           # step 3
│   └── ingress.yaml               # step 4
└── overlays/
    └── local/
        └── kustomization.yaml     # image tag "dev" + lab secrets
```

=== "base/kustomization.yaml"

    ``` yaml title="k8s/base/kustomization.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/kustomization.yaml"
    ```

=== "overlays/local/kustomization.yaml"

    ``` yaml title="k8s/overlays/local/kustomization.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/overlays/local/kustomization.yaml"
    ```

=== "namespace.yaml"

    ``` yaml title="k8s/base/namespace.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/namespace.yaml"
    ```

=== "config.yaml"

    ``` yaml title="k8s/base/config.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/config.yaml"
    ```

O `secretGenerator` acrescenta um hash do conteúdo ao nome do Secret (`db-credentials-c67…`) e reescreve
toda referência a ele: mudar uma senha produz um Secret *novo* e, portanto, um rollout dos pods que o
usam — uma credencial velha não fica esquecida num pod em execução.

## Stateful e stateless { #stateful-and-stateless }

=== "db.yaml"

    ``` yaml title="k8s/base/db.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/db.yaml"
    ```

=== "redis.yaml"

    ``` yaml title="k8s/base/redis.yaml"
    --8<-- "docs/2027.1/hands-on/10/code/k8s/base/redis.yaml"
    ```

Um **StatefulSet** dá ao banco de dados o que um Deployment não dá: uma identidade estável (`db-0`) e
um **PersistentVolumeClaim** por réplica que sobrevive aos restarts do pod. Apagar o pod mantém os
dados; apagar o PVC os apaga.

## O Deployment do `catalog` { #the-catalog-deployment }

``` yaml title="k8s/base/catalog.yaml"
--8<-- "docs/2027.1/hands-on/10/code/k8s/base/catalog.yaml"
```

As três probes respondem três perguntas diferentes, e confundi-las causa quedas:

| Probe | Pergunta | Em caso de falha | Endpoint do Spring Boot |
|---|---|---|---|
| `startupProbe` | o processo terminou de iniciar? | mantém as outras probes desligadas; restart depois do orçamento | `/actuator/health/liveness` |
| `livenessProbe` | o processo travou sem conserto? | **restart** do contêiner | `/actuator/health/liveness` (só estado interno) |
| `readinessProbe` | este pod deve receber tráfego agora? | **remove** dos endpoints do Service (sem restart) | `/actuator/health/readiness` |

!!! warning "Nunca coloque uma dependência na liveness probe"

    Se a liveness verificasse o banco de dados, uma oscilação do banco faria o Kubernetes reiniciar
    **todos** os pods do `catalog` de uma vez — transformando uma oscilação de 10 segundos em minutos
    de queda enquanto as JVMs reiniciam. O grupo de liveness do Spring Boot verifica só o estado da
    própria aplicação; é por isso que o lab 1 ativou o `management.endpoint.health.probes`.

Os `requests` são o que o scheduler reserva num nó (e a base das porcentagens do HPA); os `limits` são
o teto — acima do limite de memória o contêiner é morto (`OOMKilled`), acima do limite de CPU ele é
estrangulado (*throttled*). O Dockerfile do lab 1 dimensiona o heap com `-XX:MaxRAMPercentage=75`,
então a JVM respeita o limite de 768 Mi.

## Aplique { #apply }

<!-- termynal -->

``` shell
> kubectl apply -k k8s/overlays/local
namespace/boxoffice created
configmap/boxoffice-config created
secret/db-credentials-c677754gbf created
service/catalog created
service/db created
service/redis created
deployment.apps/catalog created
deployment.apps/redis created
statefulset.apps/db created
horizontalpodautoscaler.autoscaling/catalog created
ingress.networking.k8s.io/boxoffice created
> kubectl -n boxoffice get pods -o wide
NAME                      READY   STATUS    RESTARTS      AGE     NODE
catalog-8685666c5-5bv8t   1/1     Running   2 (45s ago)   3m31s   boxoffice-worker
catalog-8685666c5-9z7n6   1/1     Running   2 (2m ago)    3m31s   boxoffice-worker2
db-0                      1/1     Running   0             3m31s   boxoffice-worker
redis-6757b9b5ff-9klb4    1/1     Running   0             3m31s   boxoffice-worker
> curl -s -o /dev/null -w '%{http_code}\n' localhost/catalog/events/1
200
```

??? question "Por que o `catalog` reiniciou duas vezes?"

    O Kubernetes não tem `depends_on`: todos os pods sobem de uma vez. O `catalog` subiu antes de o
    PostgreSQL aceitar conexões, o Flyway falhou, a JVM saiu e o Kubernetes a reiniciou com um
    back-off exponencial até o banco estar lá (`kubectl -n boxoffice logs deploy/catalog
    --previous` mostra a primeira falha). Isso é **convergência eventual**: em vez de ordenar a
    inicialização, cada componente tenta de novo até que as suas dependências existam. Também
    significa que a primeira inicialização pode ser lenta — a startup probe permite até 5 minutos
    porque a primeira inicialização bem-sucedida também roda as migrations do Flyway do lab 1.

## Veja os controllers trabalhando { #watch-the-controllers-work }

=== "Autocura"

    ``` shell
    kubectl -n boxoffice delete pod -l app=catalog --wait=false
    kubectl -n boxoffice get pods -l app=catalog -w
    ```

    O ReplicaSet do Deployment vê 0 de 2 pods e cria dois novos imediatamente. Cronometre quanto tempo
    leva até os dois estarem `1/1 Running` de novo: esse é o seu **MTTR** (*mean time to repair*, tempo
    médio de reparo) para a queda de um pod — dominado pela inicialização da JVM.

=== "Perdendo um nó"

    ``` shell
    docker stop boxoffice-worker2
    kubectl get nodes -w            # NotReady after about a minute
    kubectl -n boxoffice get pods -o wide -w
    docker start boxoffice-worker2
    ```

    Os pods do nó perdido são substituídos nos nós restantes — mas só depois que o nó é declarado não
    saudável e as tolerations dos pods expiram (cerca de 5 minutos por padrão). O tempo de detecção
    domina a recuperação, exatamente como na
    [matemática da disponibilidade](../../../classes/estimation/availability-math/index.md).

=== "Rolling update"

    ``` shell
    kubectl -n boxoffice rollout restart deployment/catalog
    kubectl -n boxoffice rollout status deployment/catalog
    ```

    Com `maxSurge: 1` e `maxUnavailable: 0`, o Kubernetes sobe um pod novo, espera até ele estar
    **pronto**, depois termina um pod antigo, e repete. No [passo 5](../measure/index.md) você vai
    rodar o k6 durante um rollout, com e sem a readiness probe e a pausa do `preStop`, e contar os
    erros.

!!! info "Graceful shutdown, passo a passo"

    Quando um pod é terminado: (1) ele é removido dos endpoints do Service **e**, em paralelo, (2) o
    hook `preStop` roda (sleep de 5 s), depois (3) o `SIGTERM` chega à JVM, que, com
    `server.shutdown=graceful`, para de aceitar requisições e termina as que estão em andamento. Sem a
    pausa do `preStop`, o passo 3 pode acontecer antes que o proxy de cada nó tenha parado de mandar
    tráfego para o pod — e essas requisições falham com connection refused.

## Sua vez: os outros serviços { #your-turn-the-other-services }

Faça o deploy do resto do BoxOffice do mesmo jeito — um Deployment + Service para cada, as mesmas
probes, o mesmo `envFrom`. A tabela resume o que muda:

| Serviço | Porta | Configuração extra | Observações |
|---|---|---|---|
| `auth` | 8081 | `JWT_ISSUER`, `ADMIN_EMAIL`/`ADMIN_PASSWORD` (Secret) | chave privada num Secret |
| `gateway` | 8080 | `AUTH_JWKS_URI`, `CATALOG_URL`, `ORDER_URL`… (`http://<service>:<port>`) | depois aponte o Ingress para o `gateway` em vez do `catalog` |
| `inventory` | 8083 | `DB_REPLICA_HOST` | um segundo StatefulSet para a réplica, ou pule a réplica aqui |
| `order`, `notification` | 8084, 8086 | `KAFKA_BOOTSTRAP_SERVERS` | o Kafka no Kubernetes costuma ser operado por um operator (por exemplo, o Strimzi); opcional neste lab |

[Próximo: Autoscaling](../autoscaling/index.md){ .md-button .md-button--primary }
