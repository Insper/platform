Um **cache stampede** (também chamado de *thundering herd* ou *dog-piling*) acontece quando uma **chave quente** expira: toda requisição que chega antes de o valor ser reconstruído dá miss, e todas rodam a mesma consulta cara ao mesmo tempo. O banco, que o cache estava protegendo, recebe uma rajada de trabalho idêntico exatamente quando o tráfego está no auge.

``` diagram-sim
sequenceDiagram
    autonumber
    participant F1 as Fã 1
    participant F2 as Fãs 2..200
    participant C as catalog ×3
    participant R as redis
    participant DB as db
    Note over R: a chave "São Paulo, página 0" expira
    F1->>C: GET da listagem
    C->>R: GET → miss
    C->>DB: consulta pesada (join, sort, count)
    F2->>C: GET da listagem (mesma chave, mesmo instante)
    C->>R: GET → miss
    C->>DB: a MESMA consulta pesada, ×199
    Note over DB: 200 consultas idênticas, pool de 30 conexões: fila
    DB-->>C: linhas (algum dia)
    C->>R: SET (200 vezes, mesmo valor)
```

## 1. Reproduza { #1-reproduce-it }

Torne o problema frequente: uma listagem quente com **TTL de 3 s**, martelada por 200 usuários em modelo fechado, sem tempo de pensar.

``` { .javascript title="load/stampede.js" .copy linenums="1" }
--8<-- "docs/2027.1/hands-on/5/code/load/stampede.js"
```

``` { .bash .copy }
CACHE_TTL_LIST=3s CACHE_STAMPEDE_PROTECTION=false docker compose up -d
k6 run load/stampede.js
```

Em 60 s a chave expira cerca de 20 vezes. Sem proteção, `cache_misses` fica muito acima de 20 — cada expiração deixa passar toda requisição que chegou durante a recarga, uma consulta pesada para cada uma. Acompanhe o `docker stats` durante o teste: a CPU do `db` dá um pico a cada ~3 segundos, e a latência também (compare `max` e `p(99)` com `med`).

## 2. Corrija: uma reconstrução por chave { #2-fix-it-one-rebuild-per-key }

A correção implementada no `EventCache` (já está no seu código, atrás de uma chave) é um **lock distribuído por chave**:

1. Miss → tente `SET key:lock <token> NX PX 2000`. O Redis garante que só **uma** requisição no cluster inteiro (as três réplicas) o obtém.
2. A vencedora confere o cache de novo, roda a consulta, escreve o valor e libera o lock.
3. As perdedoras **não** consultam o banco: elas consultam o cache a cada 25 ms por até 500 ms e devolvem o valor assim que a vencedora o escreve (um `HIT`).
4. Se a vencedora morrer, o lock expira depois de 2 s, então ninguém espera para sempre.

``` { .java title="excerpt of services/catalog/src/main/java/boxoffice/catalog/EventCache.java (already in your code)" }
if (stampedeProtection) {
    var lockKey = key + ":lock";
    var token = UUID.randomUUID().toString();
    if (tryLock(lockKey, token)) {
        try {
            cached = read(key);               // someone may have filled it meanwhile
            if (cached != null) {
                return count(new Result(cached, "HIT"));
            }
            return count(load(key, ttl, loader));
        } finally {
            unlock(lockKey, token);
        }
    }
    // another request is already loading this key: wait for it instead of
    // sending one more identical query to the database
    for (int i = 0; i < 20; i++) {
        sleep(Duration.ofMillis(25));
        cached = read(key);
        if (cached != null) {
            return count(new Result(cached, "HIT"));
        }
    }
}
```

``` { .bash .copy }
CACHE_TTL_LIST=3s CACHE_STAMPEDE_PROTECTION=true docker compose up -d
k6 run load/stampede.js
```

Agora `cache_misses` deve ficar perto do número de expirações (~20 por minuto). Numa execução de teste deste lab (100 VUs, 30 s, TTL de 3 s), os misses caíram de **800 para 10** — uma consulta ao banco por expiração em vez de oitenta. O ganho de latência num notebook pode ser modesto (o Redis, o edge e o gateway dominam cada requisição), mas a carga no banco durante cada expiração cai quase duas ordens de grandeza, e é isso que o protege durante um pico real. Preencha a tabela do stampede em `results/lab5.md`.

## 3. Outras curas, e os seus trade-offs { #3-other-cures-and-their-trade-offs }

| Técnica | Ideia | Trade-off |
|---|---|---|
| **Lock / single flight** (este lab) | um carregador por chave, os outros esperam | threads esperando (threads do Tomcat bloqueadas; virtual threads — `spring.threads.virtual.enabled=true` — tornam a espera barata) |
| **Jitter no TTL** (também neste lab) | chaves escritas juntas expiram em momentos diferentes | não ajuda com uma *única* chave quente |
| **Atualização antecipada probabilística** (XFetch) | cada requisição pode atualizar *antes* da expiração, com uma probabilidade que cresce conforme a expiração se aproxima | sem locks; algum trabalho duplicado |
| **Stale-while-revalidate** | serve o valor expirado enquanto uma requisição atualiza em segundo plano | os clientes veem dados um pouco desatualizados |
| **Refresh-ahead** | um job em segundo plano atualiza as chaves quentes antes de expirarem | precisa saber quais chaves são quentes |
| **Agrupamento de requisições na borda** | o CDN/proxy junta misses concorrentes idênticos (`proxy_cache_lock` no Nginx) | só para respostas HTTP cacheáveis |

!!! warning "Armadilhas do lock"

    - O `unlock` faz *get* e depois *delete*: entre os dois, o lock pode expirar e ser tomado por outra requisição, e apagaríamos o lock *dela*. A versão correta é um único script Lua atômico (`if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) end`). O lab mantém a versão simples por legibilidade; o comentário no código diz isso.
    - Um lock mantido por mais tempo do que a sua expiração (uma consulta de 3 s com um lock de 2 s) deixa entrar um segundo carregador. Dimensione o TTL do lock acima do p99 da consulta.
    - Quem espera desiste depois de 500 ms e carrega mesmo assim: sob carga extrema, uma espera limitada é mais segura do que uma fila ilimitada.

??? question "Pense primeiro: a chave quente é `catalog:event:1` (o show da venda relâmpago), lida 50.000 vezes por segundo. O stampede é o seu único problema?"

    Não: mesmo com 100% de hits, **uma chave vive em um nó do Redis**. Num Redis Cluster, todas as 50.000 requisições por segundo atingem o mesmo shard — uma **chave quente**. Curas: um pequeno cache local em processo em cada réplica (alguns segundos de TTL) na frente do Redis, replicar a chave quente sob vários nomes (`event:1#0`…`event:1#9`, escolhidos ao acaso), ou empurrar a página para o CDN. A aula 7 ([modos de falha](../../../classes/caching/failure-modes/index.md)) trata disso.

Volte à [visão geral do lab](../index.md#measure-it) para registrar os resultados.
