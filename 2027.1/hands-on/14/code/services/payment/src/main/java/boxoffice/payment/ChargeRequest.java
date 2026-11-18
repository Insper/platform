package boxoffice.payment;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import java.util.UUID;

/** paymentMethod: optional, a Stripe test payment method (pm_card_visa, pm_card_visa_chargeDeclined…). */
public record ChargeRequest(@NotNull UUID orderId, @NotNull @Positive BigDecimal amount, String paymentMethod) {
}
