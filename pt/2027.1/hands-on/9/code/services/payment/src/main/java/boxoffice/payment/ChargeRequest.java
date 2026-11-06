package boxoffice.payment;

import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;
import java.util.UUID;

public record ChargeRequest(@NotNull UUID orderId, @NotNull @Positive BigDecimal amount) {
}
