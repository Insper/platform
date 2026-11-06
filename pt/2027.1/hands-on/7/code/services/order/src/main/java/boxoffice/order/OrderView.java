package boxoffice.order;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

public record OrderView(
        UUID id,
        String showId,
        String holdId,
        String customerEmail,
        BigDecimal amount,
        String status,
        OffsetDateTime createdAt) {
}
