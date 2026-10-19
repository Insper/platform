package boxoffice.order;

import boxoffice.order.OrderProperties.NotifyMode;
import boxoffice.order.outbox.Outbox;
import boxoffice.order.payment.PaymentGateway;
import boxoffice.order.payment.PaymentResponse;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.web.server.ResponseStatusException;

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
    private final PaymentGateway payments;
    private final TransactionTemplate tx;
    private final boolean resilience;

    public OrderService(JdbcClient jdbc, Outbox outbox, NotificationClient notifications,
                        OrderProperties props, PaymentGateway payments, TransactionTemplate tx,
                        @Value("${boxoffice.payment.resilience:true}") boolean resilience) {
        this.jdbc = jdbc;
        this.outbox = outbox;
        this.notifications = notifications;
        this.props = props;
        this.payments = payments;
        this.tx = tx;
        this.resilience = resilience;
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
            return new PlaceResult(order, false);
        }

        OrderEvent event = OrderEvent.placed(order);
        if (props.notifyMode() == NotifyMode.SYNC) {
            notifications.send(event);
        } else {
            outbox.append(event.eventId(), "order", order.id(), event.eventType(), event);
        }
        return new PlaceResult(order, true);
    }

    /** No @Transactional here: never hold a DB connection during a remote call. */
    public OrderView pay(UUID id) {
        OrderView order = find(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        if (!"PENDING_PAYMENT".equals(order.status())) {
            return order; // already paid or cancelled: paying twice is a no-op
        }
        PaymentResponse payment = resilience
                ? payments.charge(order.id(), order.amount())
                : payments.chargeUnprotected(order.id(), order.amount());
        String next = "AUTHORIZED".equals(payment.status()) ? "CONFIRMED" : "CANCELLED";

        tx.executeWithoutResult(status -> {
            int changed = jdbc.sql("UPDATE orders SET status = ? WHERE id = ? AND status = 'PENDING_PAYMENT'")
                    .params(next, id)
                    .update();
            if (changed == 1) {
                String type = "CONFIRMED".equals(next) ? "OrderConfirmed" : "OrderCancelled";
                OrderEvent event = new OrderEvent(UUID.randomUUID(), type, order.id(), order.showId(),
                        order.holdId(), order.customerEmail(), order.amount(), Instant.now());
                outbox.append(event.eventId(), "order", order.id(), type, event);
            }
        });
        return find(id).orElseThrow();
    }

    public Optional<OrderView> find(UUID id) {
        return jdbc.sql(SELECT + " WHERE id = ?").param(id).query(OrderView.class).optional();
    }
}
