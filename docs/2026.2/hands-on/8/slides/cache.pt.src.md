---
marp: true
lang: pt-BR
title: Hands-on 8 — Cache em memória
description: Plataformas, Microsserviços, DevOps e APIs · Insper
paginate: true
theme: platform
---

<!-- _class: lead -->
<!-- _paginate: false -->

<script>
{{INCLUDE:scripts/slides/theme.js}}
</script>

<style>
{{INCLUDE:scripts/slides/diagram.css}}
</style>

<div class="kicker">Plataformas, Microsserviços, DevOps e APIs · Hands-on 8</div>

# Hands-on 8 — Cache em memória

**Um único cache Redis compartilhado por todas as réplicas: o banco só responde em caso de miss**

<!--
Roteiro: (1) por que um cache compartilhado quando o gateway escala; (2) bancos em memória e cache-aside;
(3) estruturas de dados e persistência do Redis; (4) compose; (5) anotações do Spring Cache; (6) executar, medir.
-->

---

## Três réplicas, três caches?

<div class="q">

O gateway roda com **3 réplicas**, cada JVM com o seu próprio cache local. A réplica 1 guarda a conta 42 em cache.
A próxima requisição para a conta 42 cai na réplica 2. **O que acontece?**

</div>

* A réplica 2 não tem nada em cache → **outra consulta ao banco**.
* Cada réplica aquece o seu próprio cache: a carga no banco quase não cai.
* A solução: um **cache externo compartilhado** — todas as réplicas leem e escrevem no **mesmo armazenamento**.

---

## Um cache por JVM × um Redis compartilhado

<div class="flow" style="align-items: stretch">
<div class="group">
<div class="caption">type: simple · ConcurrentMapCache</div>
<div class="box">account-1<small>a própria cópia da conta 42</small></div>
<div class="box">account-2<small>outra cópia, outra consulta ao banco</small></div>
<div class="box red">PUT por account-1<small>account-2 fica com o nome antigo, sem expirar</small></div>
</div>
<div class="group">
<div class="caption">type: redis</div>
<div class="box">account-1 · account-2<small>sem cópia local</small></div>
<div class="box accent">redis · accounts::42<small>uma cópia, tempo de vida (TTL, <em>time to live</em>) de 300 s</small></div>
<div class="box green">PUT por account-1<small>account-2 lê o valor novo</small></div>
</div>
</div>

- Por JVM: um miss **por réplica** e uma escrita só corrige a réplica que a fez.
- Compartilhado: um miss para todas as réplicas; `@CachePut` / `@CacheEvict` agem sobre a única cópia.

<!--
O serviço `account` roda duas réplicas no compose do lab (deploy.replicas: 2); é lá que o cache vive.
A página de visão geral desenha os dois casos num diagrama passo a passo e o simulador os reproduz ("local × compartilhado").
-->

---

## Bancos de dados em memória

| | Em disco | Em memória |
|---|---|---|
| **Armazenamento** | disco (HDD / SSD) | RAM |
| **Latência de leitura** | 1–10 ms | < 1 ms |
| **Latência de escrita** | 5–20 ms | < 1 ms |
| **Durabilidade** | persistente por padrão | configurável |
| **Capacidade** | terabytes | gigabytes (limitada pela RAM) |
| **Caso de uso** | fonte da verdade | cache, sessões, contadores |

---

## Cache-aside

<div class="flow">
<div class="arrow" style="flex: .4; text-align: left">Hit</div>
<div class="box">GET accounts::42</div><div class="arrow">→</div>
<div class="box green">o JSON<small>corpo do método pulado · cerca de 0,004 s</small></div>
</div>
<div class="flow">
<div class="arrow" style="flex: .4; text-align: left">Miss</div>
<div class="box">GET accounts::42</div><div class="arrow">→</div>
<div class="box muted">(nil)</div><div class="arrow">→</div>
<div class="box orange">SELECT no PostgreSQL<small>cerca de 0,058 s</small></div><div class="arrow">→</div>
<div class="box accent">SET accounts::42<small>TTL de 300 s · próxima leitura: hit</small></div>
</div>

<div class="ok">

O banco de dados continua sendo a **fonte da verdade**; o cache só economiza idas e voltas.

</div>

---

<!-- _class: tight -->

## Redis

Remote Dictionary Server: cache, armazenamento de sessões, message broker — o cache distribuído padrão de fato.

| Tipo | Comandos principais | Uso típico |
|---|---|---|
| **String** | `SET` `GET` `INCR` `EXPIRE` | JSON em cache, contadores, tokens de rate limit |
| **Hash** | `HSET` `HGET` `HGETALL` | objetos de sessão, mapas de configuração |
| **List** | `LPUSH` `RPOP` `LRANGE` | filas de tarefas, feeds de atividade |
| **Set** | `SADD` `SMEMBERS` `SISMEMBER` | visitantes únicos, tags |
| **Sorted Set** | `ZADD` `ZRANGE` `ZRANK` | rankings, filas de prioridade |
| **Stream** | `XADD` `XREAD` `XACK` | logs de eventos duráveis, fan-out |

<p class="small">Diferentemente do Memcached (só strings), o Redis tem estruturas de dados nativas com operações O(1) ou O(log n).</p>

---

## Persistência

| Modo | Como funciona | Trade-off |
|---|---|---|
| **RDB** (snapshot) | snapshot pontual em intervalos | reinício rápido; pode perder segundos de dados |
| **AOF** (append-only file) | registra cada escrita; reexecutado no reinício | perda quase nula; arquivos maiores, reinício lento |
| **RDB + AOF** | ambos | recomendado para produção |
| **Nenhum** | puramente em memória | aceitável para um cache puro |

Este hands-on habilita o **AOF**: `--appendonly yes`.

---

## Arquitetura

<div class="flow" style="align-items: stretch">
<div class="box muted" style="flex: .6; display: flex; flex-direction: column; justify-content: center">internet</div>
<div class="arrow" style="align-self: center">:8080 →</div>
<div class="box" style="flex: .7; display: flex; flex-direction: column; justify-content: center">lb<small>Nginx</small></div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">gateway ×3</div>
<div class="box">gateway-1</div><div class="box">gateway-2</div><div class="box">gateway-3</div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">serviços</div>
<div class="box">auth</div><div class="box">account ×2</div>
</div>
<div class="arrow" style="align-self: center">→</div>
<div class="group">
<div class="caption">dados</div>
<div class="box accent">redis<small>:6379 · lido primeiro</small></div>
<div class="box orange">PostgreSQL<small>só em caso de miss</small></div>
</div>
</div>

- Todas as réplicas compartilham **um** Redis: uma entrada gravada pela réplica 1 pode ser lida pelas réplicas 2 e 3.
- Passos: **1** Docker Compose → **2** Spring Boot → **3** executar e medir.

---

## 1 · Docker Compose

<div class="cols">
<div>

```yaml
  redis:
    image: redis:7-alpine
    hostname: redis
    ports:
      - 6379:6379
    volumes:
      - redis_data:/data
    command: redis-server --appendonly yes

volumes:
  redis_data:
```

</div>
<div>

```yaml
  account:
    # ... build, DATABASE_* ...
    environment:
      REDIS_HOST: redis
      REDIS_PORT: 6379
    deploy:
      replicas: 2
    depends_on:
      - db
      - redis
```

</div>
</div>

As mesmas `REDIS_HOST` / `REDIS_PORT` em todo serviço que usa o cache (por exemplo, `auth`).

---

## 2 · Spring Boot: dependências e configuração

<div class="cols">
<div>

- `spring-boot-starter-data-redis` — Lettuce, o cliente Redis.
- `spring-boot-starter-cache` — `@Cacheable`, `@CachePut`, `@CacheEvict`.
- `@EnableCaching` na classe principal.

</div>
<div>

```yaml
spring:
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
  cache:
    type: redis
    redis:
      time-to-live: 300000
      cache-null-values: false
```

</div>
</div>

<p class="small"><code>type: redis</code> substitui o <code>ConcurrentMapCache</code> padrão, em memória; TTL de 5 minutos; <code>null</code> não vai para o cache.</p>

---

## 2 · `@Cacheable`: leitura (read-through)

```java
@Cacheable(value = "accounts", key = "#id")
public AccountOut findById(String id) {
    return accountRepository.findById(id)
        .map(AccountOut::from)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
}
```

- **Primeira chamada** com `id = "42"`: o método roda, consulta o banco e grava `accounts::42` no Redis.
- **Chamadas seguintes**: o corpo do método é **pulado**; o valor vem direto do Redis.

<p class="small">As anotações vão nos métodos da <strong>camada de serviço</strong>, não nos controllers nem nos repositories.</p>

---

## 2 · Mantendo o cache consistente

<div class="cols">
<div>

```java
@CachePut(value = "accounts", key = "#id")
public AccountOut update(String id, AccountIn dto)
```

```java
@CacheEvict(value = "accounts", key = "#id")
public void delete(String id)
```

</div>
<div>

| Anotação | Usar em | Comportamento |
|---|---|---|
| `@Cacheable` | GET | do cache; roda só no miss |
| `@CachePut` | PUT/PATCH | sempre roda; atualiza o cache |
| `@CacheEvict` | DELETE | roda; remove a chave |

</div>
</div>

<p class="small"><code>@CacheEvict(value = "accounts", allEntries = true)</code> limpa o cache inteiro (atualizações em massa).</p>

---

## 2 · Serialização JSON

A serialização Java padrão grava **binário ilegível**. Um bean `RedisConfig` troca para JSON:

```java
@Bean
public RedisCacheConfiguration cacheConfiguration(ObjectMapper objectMapper) {
    return RedisCacheConfiguration.defaultCacheConfig()
        .serializeValuesWith(RedisSerializationContext.SerializationPair
            .fromSerializer(new GenericJackson2JsonRedisSerializer(objectMapper)))
        .entryTtl(Duration.ofMinutes(5))
        .disableCachingNullValues();
}
```

<div class="warn">

Classes em cache (`AccountOut`) devem ser serializáveis em JSON: construtor sem argumentos, campos públicos ou getters, `@JsonIgnoreProperties(ignoreUnknown = true)`.

</div>

---

<!-- _class: tight -->

## 3 · Executar

```bash
docker compose up -d --build
docker compose ps -a
```

```text
NAME                STATUS     PORTS
store-redis-1       running    0.0.0.0:6379->6379/tcp
store-lb-1          running    0.0.0.0:8080->80/tcp
store-gateway-1     running
store-gateway-2     running
store-gateway-3     running
store-account-1     running
store-account-2     running
store-auth-1        running
store-db-1          running    0.0.0.0:5432->5432/tcp
```

- O container novo é o `redis`; o `account` agora roda **2 réplicas**, o gateway 3.

---

## 3 · Primeira requisição: miss · segunda: hit

```bash
curl -s http://localhost:8080/accounts/42 | jq    # 1st: miss, hits the database
docker compose exec redis redis-cli
> KEYS accounts::*                           # 1) "accounts::42"
> GET "accounts::42"                         # {"id":"42","name":"Ada Lovelace",...}
curl -s http://localhost:8080/accounts/42 | jq    # 2nd: hit
docker compose logs account --tail 20        # no database query this time
```

---

## 3 · Medir

```bash
docker compose exec redis redis-cli DEL "accounts::42"   # or the "miss" is a hit too
curl -o /dev/null -s -w "Cache miss: %{time_total}s\n" http://localhost:8080/accounts/42
curl -o /dev/null -s -w "Cache hit:  %{time_total}s\n" http://localhost:8080/accounts/42
```

- Típico: **miss 0,058 s**, **hit 0,004 s** — 10–15× mais rápido, sem ida e volta ao banco.
- O Redis responde em < 1 ms e a resposta passa só pelo gateway.

---

## 3 · TTL e taxa de hits

```bash
docker compose exec redis redis-cli
> TTL "accounts::42"          # seconds left; at 0 the key is removed
docker compose exec redis redis-cli MONITOR
docker compose exec redis redis-cli INFO stats | grep -E "keyspace_(hits|misses)"
# keyspace_hits:8
# keyspace_misses:2
```

- Depois do TTL, a próxima leitura volta a ser **miss**: o cache fica eventualmente consistente.
- O `MONITOR` mostra cada `GET` (hit ou nil) e cada `SET` (miss + gravação).
- Saudável: **> 90 % de hits** em cargas de leitura. Muitos misses? Aumente o TTL ou pré-aqueça o cache.

---

## Armadilhas

<div class="warn">

Um cache pode servir **dados desatualizados**: `@CachePut` / `@CacheEvict` nas escritas e um **TTL** o mantêm eventualmente consistente.

</div>

- Esquecer `@EnableCaching` → as anotações não fazem nada; `type: simple` → um cache por JVM, nenhum compartilhado.
- Valores binários no `redis-cli` → falta o serializador JSON.
- `MONITOR` registra **todos os comandos**: use com cuidado em produção.
- A porta `6379` é publicada só para desenvolvimento; em produção, mantenha o Redis dentro da rede Docker.

---

## Sem Docker: o simulador

<div class="flow">
<div class="box accent">Execução<small>miss, depois um hit por account-2 · 0,058 s × 0,004 s · TTL 287</small></div>
<div class="box orange">local × compartilhado<small>dois misses, depois uma leitura desatualizada após um PUT</small></div>
<div class="box green">TTL e dado desatualizado<small>um UPDATE no psql fica escondido por até 300 s</small></div>
</div>

- As páginas embutem a pilha do lab como simulador: mesma chave, TTL, anotações e saídas.
- O play roda uma página passo a passo; os botões (curl, redis-cli, psql) funcionam a qualquer momento.
- Depois da página Executar, o `INFO stats` mostra `keyspace_hits:8`, `keyspace_misses:2`: 80 % de hits.

<!--
O simulador está na visão geral (abrindo em "local × compartilhado") e no topo de Executar.
-->

---

## Pontos-chave

1. Com réplicas, um cache **local** por JVM não basta: use um cache **compartilhado** (Redis).
2. **Cache-aside**: consulte o cache, vá ao banco só em caso de **miss** e então preencha o cache.
3. O Redis fica em memória (< 1 ms), com estruturas de dados ricas; o **AOF** acrescenta durabilidade.
4. Spring Cache: `@Cacheable` lê, `@CachePut` atualiza, `@CacheEvict` invalida.
5. Um **TTL** limita a desatualização; a serialização **JSON** mantém o cache inspecionável.
6. Verifique com o `redis-cli` (`KEYS`, `GET`, `TTL`, `INFO stats`) e compare a latência de miss × hit.
7. O banco atrás do cache continua sendo **um container só**: o hands-on 9 o transforma em um cluster.
