package boxoffice.order.waitingroom;

import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ZSetOperations.TypedTuple;
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
        String key = admitted(showId, ticket);
        if (Boolean.TRUE.equals(redis.hasKey(key))) {
            return Ticket.admitted(ticket, redis.getExpire(key, TimeUnit.SECONDS));
        }
        Long rank = redis.opsForZSet().rank(queue(showId), ticket);
        if (rank == null) {
            return Ticket.unknown(ticket); // never joined, or admission expired
        }
        long position = rank + 1;
        long eta = (long) Math.ceil((double) position / props.admitPerSecond()); // Little's Law
        return Ticket.waiting(ticket, position, eta);
    }

    /** Runs on ONE instance only (see pitfalls): N replicas would admit N times the rate. */
    @Scheduled(fixedRate = 1000)
    public void admit() {
        Set<String> shows = redis.opsForSet().members(OPEN_SHOWS);
        if (shows == null) {
            return;
        }
        for (String showId : shows) {
            Set<TypedTuple<String>> next = redis.opsForZSet().popMin(queue(showId), props.admitPerSecond());
            if (next == null) {
                continue;
            }
            for (TypedTuple<String> t : next) {
                redis.opsForValue().set(admitted(showId, t.getValue()), "1", props.admissionTtl());
            }
        }
    }

    public boolean mayEnter(String showId, String ticket) {
        if (!isOpen(showId)) {
            return true; // no on-sale running for this show: no gate
        }
        return ticket != null && Boolean.TRUE.equals(redis.hasKey(admitted(showId, ticket)));
    }
}
