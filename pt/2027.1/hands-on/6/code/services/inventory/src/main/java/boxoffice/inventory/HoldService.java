package boxoffice.inventory;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/**
 * Holds: "these seats are mine for 10 minutes". The one rule that must never break:
 * a seat belongs to at most ONE live hold. Three ways to (try to) enforce it are
 * selectable with INVENTORY_LOCKING, so you can measure each one.
 */
@Service
public class HoldService {

    private static final Logger log = LoggerFactory.getLogger(HoldService.class);

    private record Seat(long id, String status, int version) { }

    private final JdbcClient jdbc;
    private final String locking;
    private final Duration holdTtl;
    private final int maxSeats;

    public HoldService(JdbcClient jdbc,
                       @Value("${inventory.locking}") String locking,
                       @Value("${inventory.hold-ttl}") Duration holdTtl,
                       @Value("${inventory.max-seats-per-hold}") int maxSeats) {
        this.jdbc = jdbc;
        this.locking = locking;
        this.holdTtl = holdTtl;
        this.maxSeats = maxSeats;
        log.info("seat locking strategy: {}", locking);
    }

    @Transactional        // READ COMMITTED (PostgreSQL's default), on the primary
    public HoldOut hold(String userId, HoldIn in) {
        var seatIds = in.seatIds().stream().distinct().sorted().toList();
        if (seatIds.size() > maxSeats) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "at most " + maxSeats + " seats per hold");
        }
        var holdId = UUID.randomUUID();
        var expiresAt = OffsetDateTime.now(ZoneOffset.UTC).plus(holdTtl);

        switch (locking) {
            case "naive" -> holdNaive(in.eventId(), seatIds, holdId);
            case "optimistic" -> holdOptimistic(in.eventId(), seatIds, holdId);
            default -> holdPessimistic(in.eventId(), seatIds, holdId);
        }

        jdbc.sql("""
                INSERT INTO inventory.holds (id, event_id, user_id, status, expires_at)
                VALUES (:id, :eventId, :userId, 'ACTIVE', :expiresAt)""")
                .param("id", holdId).param("eventId", in.eventId())
                .param("userId", userId).param("expiresAt", expiresAt)
                .update();
        for (var seatId : seatIds) {
            jdbc.sql("INSERT INTO inventory.hold_seats (hold_id, seat_id) VALUES (:holdId, :seatId)")
                    .param("holdId", holdId).param("seatId", seatId)
                    .update();
        }
        return new HoldOut(holdId, in.eventId(), "ACTIVE", expiresAt, seatIds);
    }

    // ---- strategy 1: check-then-act, no lock (WRONG on purpose) ---------------
    private void holdNaive(long eventId, List<Long> seatIds, UUID holdId) {
        var seats = read(eventId, seatIds, "");
        requireAvailable(seats, seatIds);
        // race window: another transaction may have read the same AVAILABLE seats and
        // be about to run this same UPDATE — both will "win"
        jdbc.sql("UPDATE inventory.seats SET status = 'HELD', hold_id = :holdId WHERE id IN (:ids)")
                .param("holdId", holdId).param("ids", seatIds)
                .update();
    }

    // ---- strategy 2: pessimistic, SELECT ... FOR UPDATE -----------------------
    private void holdPessimistic(long eventId, List<Long> seatIds, UUID holdId) {
        // row locks until commit; a second transaction on the same seats WAITS here.
        // Locking in id order (ORDER BY id) prevents deadlocks between overlapping holds.
        var seats = read(eventId, seatIds, "ORDER BY id FOR UPDATE");
        requireAvailable(seats, seatIds);
        jdbc.sql("UPDATE inventory.seats SET status = 'HELD', hold_id = :holdId, version = version + 1 WHERE id IN (:ids)")
                .param("holdId", holdId).param("ids", seatIds)
                .update();
    }

    // ---- strategy 3: optimistic, compare-and-set on a version column ---------------
    private void holdOptimistic(long eventId, List<Long> seatIds, UUID holdId) {
        var seats = read(eventId, seatIds, "");                      // no lock
        requireAvailable(seats, seatIds);
        for (var seat : seats) {
            int changed = jdbc.sql("""
                    UPDATE inventory.seats
                    SET status = 'HELD', hold_id = :holdId, version = version + 1
                    WHERE id = :id AND version = :version AND status = 'AVAILABLE'""")
                    .param("holdId", holdId).param("id", seat.id()).param("version", seat.version())
                    .update();
            if (changed == 0) {
                // someone changed this seat after we read it: give up (the exception rolls back)
                throw new ResponseStatusException(HttpStatus.CONFLICT, "seat " + seat.id() + " was just taken");
            }
        }
    }

    private List<Seat> read(long eventId, List<Long> seatIds, String suffix) {
        return jdbc.sql("SELECT id, status, version FROM inventory.seats "
                        + "WHERE event_id = :eventId AND id IN (:ids) " + suffix)
                .param("eventId", eventId).param("ids", seatIds)
                .query((rs, n) -> new Seat(rs.getLong("id"), rs.getString("status"), rs.getInt("version")))
                .list();
    }

    private static void requireAvailable(List<Seat> seats, List<Long> seatIds) {
        if (seats.size() != seatIds.size()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "some seats do not belong to this event");
        }
        if (seats.stream().anyMatch(s -> !"AVAILABLE".equals(s.status()))) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "some seats are not available");
        }
    }

    // ---- reading, confirming and releasing a hold (always on the primary) -----

    @Transactional        // NOT readOnly: read-your-writes, the user just created it
    public HoldOut find(String userId, UUID holdId) {
        var hold = jdbc.sql("""
                SELECT id, event_id, status, expires_at FROM inventory.holds
                WHERE id = :id AND user_id = :userId""")
                .param("id", holdId).param("userId", userId)
                .query((rs, n) -> new HoldOut(rs.getObject("id", UUID.class), rs.getLong("event_id"),
                        rs.getString("status"), rs.getObject("expires_at", OffsetDateTime.class), List.of()))
                .optional()
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "hold not found"));
        var seatIds = jdbc.sql("SELECT seat_id FROM inventory.hold_seats WHERE hold_id = :id ORDER BY seat_id")
                .param("id", holdId).query(Long.class).list();
        return new HoldOut(hold.id(), hold.eventId(), hold.status(), hold.expiresAt(), seatIds);
    }

    /** Payment succeeded (lab 7 calls this): seats become SOLD. */
    @Transactional
    public HoldOut confirm(String userId, UUID holdId) {
        int changed = jdbc.sql("""
                UPDATE inventory.holds SET status = 'CONFIRMED'
                WHERE id = :id AND user_id = :userId AND status = 'ACTIVE' AND expires_at > now()""")
                .param("id", holdId).param("userId", userId)
                .update();
        if (changed == 0) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "hold is not active (expired, released or unknown)");
        }
        jdbc.sql("UPDATE inventory.seats SET status = 'SOLD', version = version + 1 WHERE hold_id = :id")
                .param("id", holdId).update();
        return find(userId, holdId);
    }

    @Transactional
    public void release(String userId, UUID holdId) {
        int changed = jdbc.sql("""
                UPDATE inventory.holds SET status = 'RELEASED'
                WHERE id = :id AND user_id = :userId AND status = 'ACTIVE'""")
                .param("id", holdId).param("userId", userId)
                .update();
        if (changed == 0) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "no active hold " + holdId);
        }
        freeSeatsOf(holdId);
    }

    private void freeSeatsOf(UUID holdId) {
        jdbc.sql("""
                UPDATE inventory.seats SET status = 'AVAILABLE', hold_id = NULL, version = version + 1
                WHERE hold_id = :id AND status = 'HELD'""")
                .param("id", holdId).update();
    }

    /**
     * Every 5 s, expire old holds and free their seats. FOR UPDATE SKIP LOCKED lets several
     * inventory replicas run this job at the same time without processing the same hold twice.
     */
    @Scheduled(fixedDelay = 5000)
    @Transactional
    public void expireHolds() {
        int freed = jdbc.sql("""
                WITH expired AS (
                    UPDATE inventory.holds SET status = 'EXPIRED'
                    WHERE id IN (SELECT id FROM inventory.holds
                                 WHERE status = 'ACTIVE' AND expires_at < now()
                                 ORDER BY expires_at
                                 LIMIT 500
                                 FOR UPDATE SKIP LOCKED)
                    RETURNING id)
                UPDATE inventory.seats
                SET status = 'AVAILABLE', hold_id = NULL, version = version + 1
                WHERE status = 'HELD' AND hold_id IN (SELECT id FROM expired)""")
                .update();
        if (freed > 0) {
            log.info("expired holds freed {} seats", freed);
        }
    }
}
