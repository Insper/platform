package boxoffice.notification;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

/** The consumer's own view of the event: unknown fields are ignored (tolerant reader). */
public record OrderEvent(
        UUID eventId,
        String eventType,
        UUID orderId,
        String showId,
        String holdId,
        String customerEmail,
        BigDecimal amount,
        Instant occurredAt) {
}
