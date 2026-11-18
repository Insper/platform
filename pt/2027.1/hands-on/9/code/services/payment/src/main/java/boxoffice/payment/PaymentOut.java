package boxoffice.payment;

import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.UUID;

public record PaymentOut(
        UUID id,
        UUID orderId,
        BigDecimal amount,
        String status,
        String providerRef,
        OffsetDateTime createdAt) {
}
