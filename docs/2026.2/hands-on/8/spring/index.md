Spring Boot integrates with Redis through two complementary abstractions: **Spring Cache** (declarative, annotation-driven caching) and **Spring Data Redis** (low-level `RedisTemplate` for custom operations). For most use cases, Spring Cache is sufficient.

## 1 Dependencies

Add the following to the `pom.xml` of each microservice that will use the cache:

``` { .xml .copy .select }
<!-- Redis client and Spring Data Redis -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-redis</artifactId>
</dependency>

<!-- Spring Cache abstraction -->
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-cache</artifactId>
</dependency>
```

- `spring-boot-starter-data-redis` pulls in Lettuce, the non-blocking Redis client used by Spring Boot by default.
- `spring-boot-starter-cache` provides the `@Cacheable`, `@CachePut`, and `@CacheEvict` annotations.

## 2 Configuration

Configure the Redis connection and cache behaviour in `application.yaml`:

``` { .yaml .copy .select title="application.yaml" }
spring:
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
  cache:
    type: redis
    redis:
      time-to-live: 300000    # 5 minutes in milliseconds
      cache-null-values: false
```

| Property | Value | Meaning |
|---|---|---|
| `host` / `port` | env vars | Resolved from Docker Compose environment at runtime |
| `type: redis` | — | Forces Spring Cache to use Redis; disables the default in-memory `ConcurrentMapCache` |
| `time-to-live` | 300 000 ms | Keys expire automatically after 5 minutes — prevents stale data indefinitely |
| `cache-null-values` | false | Do not cache `null` results; allows re-query when a record doesn't exist yet |

## 3 Enable caching

Add `@EnableCaching` to the application's main class (or any `@Configuration` class):

``` { .java .copy .select }
@SpringBootApplication
@EnableCaching
public class AccountApplication {
    public static void main(String[] args) {
        SpringApplication.run(AccountApplication.class, args);
    }
}
```

## 4 Cache annotations

Place annotations on **service-layer methods**, not on controllers or repositories.

### `@Cacheable` — read-through cache

Checks the cache before executing the method. If an entry exists for the key, the method body is **skipped** and the cached value is returned directly.

``` { .java .copy .select }
@Cacheable(value = "accounts", key = "#id")
public AccountOut findById(String id) {
    return accountRepository.findById(id)
        .map(AccountOut::from)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
}
```

On the **first call** for `id = "42"`: the method executes, queries the database, and stores the result under the key `accounts::42` in Redis.

On **subsequent calls** for the same id: the method body is not executed. Spring retrieves `accounts::42` from Redis and returns it immediately.

### `@CachePut` — write-through cache

**Always** executes the method body and updates the cache with the return value. Used to keep the cache consistent after an update.

``` { .java .copy .select }
@CachePut(value = "accounts", key = "#id")
public AccountOut update(String id, AccountIn dto) {
    Account account = accountRepository.findById(id)
        .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    account.update(dto);
    return AccountOut.from(accountRepository.save(account));
}
```

### `@CacheEvict` — invalidate

Removes the cache entry for the given key. Used on delete operations so subsequent reads go to the database.

``` { .java .copy .select }
@CacheEvict(value = "accounts", key = "#id")
public void delete(String id) {
    accountRepository.deleteById(id);
}
```

To evict **all entries** in a cache (e.g. on bulk updates):

``` { .java .copy .select }
@CacheEvict(value = "accounts", allEntries = true)
public void deleteAll() {
    accountRepository.deleteAll();
}
```

## 5 Serialisation

By default, Spring Data Redis uses Java serialisation, which produces unreadable binary keys and values. Configure JSON serialisation so cache contents are inspectable with `redis-cli`:

``` { .java .copy .select }
@Configuration
public class RedisConfig {

    @Bean
    public RedisCacheConfiguration cacheConfiguration(ObjectMapper objectMapper) {
        return RedisCacheConfiguration.defaultCacheConfig()
            .serializeValuesWith(
                RedisSerializationContext.SerializationPair.fromSerializer(
                    new GenericJackson2JsonRedisSerializer(objectMapper)
                )
            )
            .entryTtl(Duration.ofMinutes(5))
            .disableCachingNullValues();
    }
}
```

With this configuration, running `redis-cli GET "accounts::42"` returns a human-readable JSON string instead of binary garbage.

!!! warning "Cached classes must be serialisable"
    All classes stored in the cache (`AccountOut`, etc.) must be JSON-serialisable. Ensure they have a no-argument constructor (required by Jackson) and that all fields are public or have getter methods. Add `@JsonIgnoreProperties(ignoreUnknown = true)` to be safe when the class evolves.

## Summary

| Annotation | When to use | Cache behaviour |
|---|---|---|
| `@Cacheable` | Read (GET) operations | Return cached; execute only on miss |
| `@CachePut` | Write (PUT/PATCH) operations | Always execute; update cache with result |
| `@CacheEvict` | Delete (DELETE) operations | Execute; remove key from cache |
