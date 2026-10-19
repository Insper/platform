package boxoffice.order.payment;

import io.github.resilience4j.bulkhead.annotation.Bulkhead;
import io.github.resilience4j.circuitbreaker.annotation.CircuitBreaker;
import io.github.resilience4j.retry.annotation.Retry;
import java.math.BigDecimal;
import java.util.UUID;
import org.springframework.stereotype.Component;

/**
 * Default aspect order: Retry ( CircuitBreaker ( Bulkhead ( call ) ) ).
 * The fallback sits on the OUTERMOST layer, so it runs only after the retries are exhausted,
 * when the circuit is open or when the bulkhead is full.
 */
@Component
public class PaymentGateway {

    private final PaymentClient client;

    public PaymentGateway(PaymentClient client) {
        this.client = client;
    }

    @Retry(name = "payment", fallbackMethod = "unavailable")
    @CircuitBreaker(name = "payment")
    @Bulkhead(name = "payment")
    public PaymentResponse charge(UUID orderId, BigDecimal amount) {
        return client.charge(orderId, amount);
    }

    /** The "before" path of the experiments: no Resilience4j at all. */
    public PaymentResponse chargeUnprotected(UUID orderId, BigDecimal amount) {
        return client.charge(orderId, amount);
    }

    /** Same parameters + the exception: Resilience4j finds it by name and signature. */
    private PaymentResponse unavailable(UUID orderId, BigDecimal amount, Throwable cause) {
        throw new PaymentUnavailableException(cause);
    }
}
