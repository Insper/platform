package boxoffice.order.payment;

import java.math.BigDecimal;
import java.util.UUID;

public record PaymentRequest(UUID orderId, BigDecimal amount) {
}
