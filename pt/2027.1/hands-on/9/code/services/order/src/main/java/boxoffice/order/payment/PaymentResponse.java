package boxoffice.order.payment;

import java.util.UUID;

/** status: AUTHORIZED or DECLINED */
public record PaymentResponse(UUID id, UUID orderId, String status) {
}
