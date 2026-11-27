package boxoffice.payment;

import java.math.BigDecimal;
import java.util.UUID;

/** A payment service provider: the fake of lab 9 or the Stripe sandbox. */
public interface Psp {

    /** id: the provider's reference; approved: false when the card was declined. */
    record Charge(String id, boolean approved) {
    }

    /** Charges once per idempotency key, however many times it is called. */
    Charge charge(String idempotencyKey, BigDecimal amount, UUID orderId, String paymentMethod);
}
