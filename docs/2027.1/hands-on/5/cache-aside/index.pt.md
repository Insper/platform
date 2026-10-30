**Cache-aside** (também chamado de *lazy loading*) é o padrão de cache mais comum: a aplicação conversa tanto com o cache quanto com o banco, e o cache só contém o que alguém pediu recentemente.

| Padrão | Quem carrega o cache | Escritas | Usado aqui? |
|---|---|---|---|
| **Cache-aside** | a aplicação, em um miss | vão para o banco; a aplicação remove/atualiza a chave | **sim** |
| Read-through | o próprio cache (um loader plugado nele) | — | não |
| Write-through | — | a aplicação escreve no cache, que escreve no banco de forma síncrona | não |
| Write-behind | — | o cache confirma e escreve no banco depois (risco de perda) | não |

## 1. Redis no Compose { #1-redis-in-compose }

Adicione um serviço `redis` e dê às réplicas do catalog as configurações do cache (o arquivo inteiro, para referência):

``` { .yaml title="docker-compose.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/docker-compose.yaml"
```

| Configuração | Por quê |
|---|---|
| `--maxmemory 256mb --maxmemory-policy allkeys-lru` | um cache precisa ser **limitado**; quando cheio, o Redis remove as chaves usadas menos recentemente em vez de falhar as escritas |
| `--save "" --appendonly no` | sem persistência: um cache sempre pode ser reconstruído a partir do banco (e um reinício é uma partida a frio — meça!) |
| `depends_on: redis: condition: service_healthy` | sobe as réplicas depois que o Redis responde ao `PING` (mas elas também sobrevivem sem ele, veja abaixo) |
| variáveis `CACHE_*` | ligam/desligam o cache, mudam TTLs e a proteção contra stampede **sem reconstruir** |

## 2. Dependências e configuração { #2-dependencies-and-configuration }

Adicione o starter do Redis ao `services/catalog/pom.xml` (ele traz o Lettuce, um cliente Redis não bloqueante, e o `StringRedisTemplate`):

``` { .xml title="services/catalog/pom.xml" .copy linenums="1" hl_lines="59-63" }
--8<-- "docs/2027.1/hands-on/5/code/services/catalog/pom.xml"
```

``` { .yaml title="services/catalog/src/main/resources/application.yaml" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/resources/application.yaml"
```

Os **timeouts de 200 ms** importam: o timeout padrão de comando do Lettuce é de 60 segundos. Se o Redis travar, toda requisição travaria junto — um cache que deveria deixar as coisas mais rápidas derrubaria o serviço inteiro.

## 3. O componente de cache { #3-the-cache-component }

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventCache.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventCache.java"
```

Decisões de design, uma a uma:

- **Guarde o JSON da resposta**, não objetos Java. Um hit devolve a string como está: sem banco, sem mapeamento de objetos, sem serialização. Ela também é legível com `redis-cli GET`.
- **Jackson 3**: o Spring Boot 4 vem com o Jackson 3 (pacote `tools.jackson`). O bean de JSON é um `JsonMapper`, e as suas exceções são unchecked, então `toJson` não precisa de `try/catch`.
- **TTL com jitter** (`+0–10%`): chaves escritas no mesmo segundo não expiram todas no mesmo segundo.
- **Falhas do Redis viram misses** (`catch (DataAccessException e)`): o cache é uma otimização, nunca uma dependência obrigatória. Com o Redis fora do ar, o `catalog` fica tão lento quanto antes do lab 5, mas funciona.
- **Um contador por resultado** (`catalog.cache.requests{result=HIT|MISS|BYPASS}`) em cada réplica, visível em `/actuator/metrics/catalog.cache.requests` — e no Grafana no lab 8.
- O ramo de **proteção contra stampede** é explicado no [passo 2](../stampede/index.md); ele vem desligado por padrão para que você veja o problema primeiro.

## 4. O controller { #4-the-controller }

Os endpoints GET agora devolvem `ResponseEntity<String>` — o JSON vem do cache ou é produzido em um miss — mais o header `X-Cache`. As escritas **removem** a chave do evento depois do commit no banco:

``` { .java title="services/catalog/src/main/java/boxoffice/catalog/EventController.java" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/services/catalog/src/main/java/boxoffice/catalog/EventController.java"
```

!!! warning "Por que remover em vez de atualizar a chave?"

    Duas atualizações concorrentes podem escrever no cache na ordem inversa dos commits no banco, deixando a versão *mais antiga* em cache até o TTL. Apagar a chave é idempotente: a próxima leitura carrega o que o banco tiver. Mesmo a remoção tem uma condição de corrida (um leitor carrega a linha antiga logo antes do commit da atualização e a escreve *depois* da remoção), e é por isso que toda chave também tem um TTL: **o TTL é a rede de segurança de todo esquema de invalidação**.

As páginas de listagem **não** são removidas: uma mudança em um evento pode afetar milhares de chaves de listagem (toda cidade/página que o contém). Em vez disso, elas expiram depois de `CACHE_TTL_LIST` (10 s) — uma escolha deliberada de **defasagem limitada** para a listagem em troca de simplicidade.

## 5. Confira { #5-check-it }

``` { .bash .copy }
docker compose up --build -d
curl -s -o /dev/null -D - localhost/catalog/events/42 | grep -iE "x-cache|x-instance"
curl -s -o /dev/null -D - localhost/catalog/events/42 | grep -iE "x-cache|x-instance"
docker compose exec redis redis-cli GET catalog:event:42
docker compose exec redis redis-cli TTL catalog:event:42
```

<!-- termynal -->
``` shell
> curl -s -o /dev/null -D - localhost/catalog/events/42 | grep -iE "x-cache|x-instance"
X-Instance: catalog-2
X-Cache: MISS
> curl -s -o /dev/null -D - localhost/catalog/events/42 | grep -iE "x-cache|x-instance"
X-Instance: catalog-3
X-Cache: HIT
> docker compose exec redis redis-cli TTL catalog:event:42
(integer) 62
```

A segunda requisição foi atendida por **outra réplica** (se as duas caíram na mesma, rode de novo: o gateway alterna as réplicas) e ainda assim foi um hit: o cache é **compartilhado** (distribuído), não local a cada JVM. Com um cache local (Caffeine, um `HashMap`), cada uma das três réplicas aqueceria separadamente e poderia guardar uma versão diferente do mesmo evento.

Agora quebre de propósito:

``` { .bash .copy }
# invalidation: update event 42 as admin, then read it
ADMIN=$(curl -s -X POST localhost/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"admin@boxoffice.dev","password":"boxoffice-admin"}' | jq -r .accessToken)
curl -s -X PUT localhost/catalog/events/42 -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"title":"Festival #42 (new lineup)","category":"FESTIVAL","venueId":45,"startsAt":"2027-03-03T14:00:00-03:00","priceFrom":175}' > /dev/null
curl -s -D - localhost/catalog/events/42 | grep -iE "x-cache|title"

# resilience: no Redis, still working (slower, all MISS)
docker compose stop redis
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" -D - localhost/catalog/events/42 | grep -iE "x-cache|^200"
docker compose start redis
```

!!! tip "Na entrevista"

    Ao acrescentar um cache, diga quatro coisas: **o que** fica em cache (e a chave), a estratégia de **TTL e invalidação** (e a defasagem que você aceita), o **hit ratio** esperado (e por quê — popularidade concentrada) e **o que acontece quando o cache falha** (volta para o banco, protegido contra um stampede). Os entrevistadores investigam as duas últimas.

Próximo: [2. Stampede](../stampede/index.md).
