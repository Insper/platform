package boxoffice.order.waitingroom;

import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
public class WaitingRoom {

    private static final String OPEN_SHOWS = "wr:open";

    private final StringRedisTemplate redis;
    private final WaitingRoomProperties props;

    public WaitingRoom(StringRedisTemplate redis, WaitingRoomProperties props) {
        this.redis = redis;
        this.props = props;
    }

    private static String queue(String showId) { return "wr:" + showId + ":queue"; }
    private static String seq(String showId) { return "wr:" + showId + ":seq"; }
    private static String admitted(String showId, String ticket) { return "wr:" + showId + ":admitted:" + ticket; }

    public void open(String showId) { redis.opsForSet().add(OPEN_SHOWS, showId); }

    public void close(String showId) { redis.opsForSet().remove(OPEN_SHOWS, showId); }

    public boolean isOpen(String showId) {
        return Boolean.TRUE.equals(redis.opsForSet().isMember(OPEN_SHOWS, showId));
    }

    public Ticket join(String showId) {
        String ticket = UUID.randomUUID().toString();
        Long arrival = redis.opsForValue().increment(seq(showId)); // the server decides the order
        redis.opsForZSet().add(queue(showId), ticket, arrival);
        return status(showId, ticket);
    }

    public Ticket status(String showId, String ticket) {
        // queue first: the admitter moves a ticket from the queue to "admitted" in one atomic step
        Long rank = redis.opsForZSet().rank(queue(showId), ticket);
        if (rank != null) {
            long position = rank + 1;
            long eta = (long) Math.ceil((double) position / props.admitPerSecond()); // Little's Law
            return Ticket.waiting(ticket, position, eta);
        }
        String key = admitted(showId, ticket);
        if (Boolean.TRUE.equals(redis.hasKey(key))) {
            return Ticket.admitted(ticket, redis.getExpire(key, TimeUnit.SECONDS));
        }
        return Ticket.unknown(ticket); // never joined, or admission expired
    }

    /** ZPOPMIN + SET in one Lua script: a polling fan never sees a ticket that is neither queued nor admitted. */
    private static final RedisScript<Long> POP_AND_ADMIT = RedisScript.of("""
            local popped = redis.call('ZPOPMIN', KEYS[1], ARGV[1])
            for i = 1, #popped, 2 do
                redis.call('SET', ARGV[2] .. popped[i], '1', 'EX', ARGV[3])
            end
            return #popped / 2
            """, Long.class);

    /** Runs on ONE instance only (see pitfalls): N replicas would admit N times the rate. */
    @Scheduled(fixedRate = 1000)
    public void admit() {
        Set<String> shows = redis.opsForSet().members(OPEN_SHOWS);
        if (shows == null) {
            return;
        }
        for (String showId : shows) {
            redis.execute(POP_AND_ADMIT, List.of(queue(showId)), String.valueOf(props.admitPerSecond()),
                    admitted(showId, ""), String.valueOf(props.admissionTtl().toSeconds()));
        }
    }

    public boolean mayEnter(String showId, String ticket) {
        if (!isOpen(showId)) {
            return true; // no on-sale running for this show: no gate
        }
        return ticket != null && Boolean.TRUE.equals(redis.hasKey(admitted(showId, ticket)));
    }
}
