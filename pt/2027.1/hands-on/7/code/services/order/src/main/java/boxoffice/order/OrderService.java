package boxoffice.order;

import boxoffice.order.OrderProperties.NotifyMode;
import boxoffice.order.outbox.Outbox;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class OrderService {

    public record PlaceResult(OrderView order, boolean created) {
    }

    private static final String SELECT = """
            SELECT id, show_id, hold_id, customer_email, amount, status, created_at
            FROM orders
            """;

    private final JdbcClient jdbc;
    private final Outbox outbox;
    private final NotificationClient notifications;
    private final OrderProperties props;

    public OrderService(JdbcClient jdbc, Outbox outbox, NotificationClient notifications,
                        OrderProperties props) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.notifications = notifications;
        this.props = props;
    }

    @Transactional
    public PlaceResult place(OrderRequest req) {
        int inserted = jdbc.sql("""
                INSERT INTO orders (id, show_id, hold_id, customer_email, amount, status)
                VALUES (?, ?, ?, ?, ?, 'PENDING_PAYMENT')
                ON CONFLICT (hold_id) DO NOTHING
                """)
                .params(UUID.randomUUID(), req.showId(), req.holdId(), req.customerEmail(), req.amount())
                .update();

        OrderView order = jdbc.sql(SELECT + " WHERE hold_id = ?")
                .param(req.holdId())
                .query(OrderView.class)
                .single();

        if (inserted == 0) {
            // same hold already ordered: idempotent replay, no second event
            return new PlaceResult(order, false);
        }

        OrderEvent event = OrderEvent.placed(order);
        if (props.notifyMode() == NotifyMode.SYNC) {
            notifications.send(event); // BEFORE: the fan waits for the e-mail
        } else {
            outbox.append(event.eventId(), "order", order.id(), event.eventType(), event);
        }
        return new PlaceResult(order, true);
    }

    public Optional<OrderView> find(UUID id) {
        return jdbc.sql(SELECT + " WHERE id = ?").param(id).query(OrderView.class).optional();
    }
}
