package boxoffice.notification;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {

    private static final Logger log = LoggerFactory.getLogger(NotificationService.class);

    private final JdbcClient jdbc;
    private final EmailSender email;
    private final NotificationProperties props;

    public NotificationService(JdbcClient jdbc, EmailSender email, NotificationProperties props) {
        this.jdbc = jdbc;
        this.email = email;
        this.props = props;
    }

    /** @return true if an e-mail was sent, false if the event was a duplicate */
    @Transactional
    public boolean handle(OrderEvent e) {
        if (props.idempotent()) {
            int fresh = jdbc.sql("INSERT INTO processed_events (event_id) VALUES (?) ON CONFLICT DO NOTHING")
                    .param(e.eventId())
                    .update();
            if (fresh == 0) {
                log.info("duplicate event {} for order {} ignored", e.eventId(), e.orderId());
                return false;
            }
        }
        email.orderReceived(e); // throws -> the whole transaction rolls back, the dedupe row too
        jdbc.sql("""
                INSERT INTO notifications (event_id, order_id, email, kind, occurred_at)
                VALUES (?, ?, ?, ?, ?)
                """)
                .params(e.eventId(), e.orderId(), e.customerEmail(), e.eventType(),
                        OffsetDateTime.ofInstant(e.occurredAt(), ZoneOffset.UTC))
                .update();
        return true;
    }
}
