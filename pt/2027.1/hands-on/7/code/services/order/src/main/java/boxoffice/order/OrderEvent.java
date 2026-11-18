package boxoffice.order;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** The fact published on order-events. eventId is unique per event: consumers dedupe by it. */
public record OrderEvent(
        UUID eventId,
        String eventType,
        UUID orderId,
        String showId,
        String holdId,
        String customerEmail,
        BigDecimal amount,
        Instant occurredAt) {

    public static OrderEvent placed(OrderView order) {
        return new OrderEvent(UUID.randomUUID(), "OrderPlaced", order.id(), order.showId(),
                order.holdId(), order.customerEmail(), order.amount(), Instant.now());
    }
}
