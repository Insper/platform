package boxoffice.catalog;

import io.micrometer.core.instrument.MeterRegistry;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.ThreadLocalRandom;
import java.util.function.Supplier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.dao.DataAccessException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;

/**
 * Cache-aside in Redis. The application asks the cache first; on a miss it loads from
 * the database and writes the JSON into the cache with a TTL. Values are stored as the
 * exact JSON returned to clients, so a hit costs no database access and no serialization.
 */
@Component
public class EventCache {

    private static final Logger log = LoggerFactory.getLogger(EventCache.class);

    /** The JSON body and what happened: HIT, MISS or BYPASS (cache disabled). */
    public record Result(String json, String outcome) { }

    private final StringRedisTemplate redis;
    private final JsonMapper mapper;            // Jackson 3 (Spring Boot 4)
    private final MeterRegistry metrics;
    private final boolean enabled;
    private final boolean stampedeProtection;
    private final Duration eventTtl;
    private final Duration listTtl;

    public EventCache(StringRedisTemplate redis, JsonMapper mapper, MeterRegistry metrics,
                      @Value("${catalog.cache.enabled}") boolean enabled,
                      @Value("${catalog.cache.stampede-protection}") boolean stampedeProtection,
                      @Value("${catalog.cache.event-ttl}") Duration eventTtl,
                      @Value("${catalog.cache.list-ttl}") Duration listTtl) {
        this.redis = redis;
        this.mapper = mapper;
        this.metrics = metrics;
        this.enabled = enabled;
        this.stampedeProtection = stampedeProtection;
        this.eventTtl = eventTtl;
        this.listTtl = listTtl;
    }

    public Duration eventTtl() { return eventTtl; }
    public Duration listTtl() { return listTtl; }

    public Result get(String key, Duration ttl, Supplier<?> loader) {
        if (!enabled) {
            return count(new Result(toJson(loader.get()), "BYPASS"));
        }
        var cached = read(key);
        if (cached != null) {
            return count(new Result(cached, "HIT"));
        }
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
        return count(load(key, ttl, loader));
    }

    public void evict(String key) {
        try {
            redis.delete(key);
        } catch (DataAccessException e) {
            log.warn("cache evict failed for {}: {}", key, e.getMessage());
        }
    }

    // ---- internals --------------------------------------------------------

    private Result load(String key, Duration ttl, Supplier<?> loader) {
        var json = toJson(loader.get());
        try {
            redis.opsForValue().set(key, json, withJitter(ttl));
        } catch (DataAccessException e) {
            log.warn("cache write failed for {}: {}", key, e.getMessage());
        }
        return new Result(json, "MISS");
    }

    private String read(String key) {
        try {
            return redis.opsForValue().get(key);
        } catch (DataAccessException e) {
            // Redis down or slow: the cache is an optimization, not a dependency
            log.warn("cache read failed for {}: {}", key, e.getMessage());
            return null;
        }
    }

    private boolean tryLock(String lockKey, String token) {
        try {
            // SET lockKey token NX PX 2000: only one request in the whole cluster gets it
            return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(lockKey, token, Duration.ofSeconds(2)));
        } catch (DataAccessException e) {
            return true;                              // no Redis, no lock: just load
        }
    }

    private void unlock(String lockKey, String token) {
        try {
            // delete only our own lock (it may have expired and been taken by someone else);
            // get + delete is not atomic: production code uses a Lua script for this
            if (token.equals(redis.opsForValue().get(lockKey))) {
                redis.delete(lockKey);
            }
        } catch (DataAccessException e) {
            log.debug("unlock failed: {}", e.getMessage());
        }
    }

    /** TTL plus up to 10% random extra, so that keys written together do not expire together. */
    private static Duration withJitter(Duration ttl) {
        long extra = (long) (ttl.toMillis() * 0.10 * ThreadLocalRandom.current().nextDouble());
        return ttl.plusMillis(extra);
    }

    private Result count(Result result) {
        metrics.counter("catalog.cache.requests", "result", result.outcome()).increment();
        return result;
    }

    private String toJson(Object value) {
        return mapper.writeValueAsString(value);    // Jackson 3 exceptions are unchecked
    }

    private static void sleep(Duration d) {
        try {
            Thread.sleep(d);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
