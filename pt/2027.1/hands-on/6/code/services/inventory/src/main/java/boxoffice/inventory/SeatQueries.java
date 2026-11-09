package boxoffice.inventory;

import java.util.List;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Read-only queries: they run on the REPLICA (readOnly = true), so they may be slightly stale. */
@Service
public class SeatQueries {

    private final JdbcClient jdbc;

    public SeatQueries(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    @Transactional(readOnly = true)
    public List<SectionAvailability> availability(long eventId) {
        return jdbc.sql("""
                SELECT section,
                       count(*) FILTER (WHERE status = 'AVAILABLE') AS available,
                       count(*) FILTER (WHERE status = 'HELD')      AS held,
                       count(*) FILTER (WHERE status = 'SOLD')      AS sold
                FROM inventory.seats
                WHERE event_id = :eventId
                GROUP BY section
                ORDER BY section""")
                .param("eventId", eventId)
                .query((rs, n) -> new SectionAvailability(rs.getString("section"),
                        rs.getLong("available"), rs.getLong("held"), rs.getLong("sold")))
                .list();
    }

    @Transactional(readOnly = true)
    public List<SeatOut> seats(long eventId, String section) {
        return jdbc.sql("""
                SELECT id, section, seat_row, seat_number, price, status
                FROM inventory.seats
                WHERE event_id = :eventId AND section = :section
                ORDER BY seat_row, seat_number""")
                .param("eventId", eventId)
                .param("section", section)
                .query((rs, n) -> new SeatOut(rs.getLong("id"), rs.getString("section"),
                        rs.getInt("seat_row"), rs.getInt("seat_number"),
                        rs.getBigDecimal("price"), rs.getString("status")))
                .list();
    }

    /** Seats that belong to more than one live hold: must always be 0. Reads the PRIMARY. */
    @Transactional
    public long doubleBookedSeats() {
        return jdbc.sql("""
                SELECT count(*) FROM (
                    SELECT hs.seat_id
                    FROM inventory.hold_seats hs
                    JOIN inventory.holds h ON h.id = hs.hold_id
                    WHERE h.status IN ('ACTIVE', 'CONFIRMED')
                    GROUP BY hs.seat_id
                    HAVING count(*) > 1) AS doubles""")
                .query(Long.class)
                .single();
    }
}
