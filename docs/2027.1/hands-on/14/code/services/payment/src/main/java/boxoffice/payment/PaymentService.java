package boxoffice.payment;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class PaymentService {

    public record Result(PaymentOut payment, boolean created) {
    }

    private final JdbcClient jdbc;
    private final Psp psp;

    public PaymentService(JdbcClient jdbc, Psp psp) {
        this.jdbc = jdbc;
        this.psp = psp;
    }

    public Result charge(String idempotencyKey, ChargeRequest req) {
        Optional<PaymentOut> done = find(idempotencyKey);
        if (done.isPresent()) {
            return new Result(done.get(), false); // a retry: answer, do not charge again
        }
        // remote call OUTSIDE any database transaction: never hold a connection while waiting
        Psp.Charge charge = psp.charge(idempotencyKey, req.amount(), req.orderId(), req.paymentMethod());
        String status = charge.approved() ? "AUTHORIZED" : "DECLINED";
        jdbc.sql("""
                INSERT INTO payments (id, idempotency_key, order_id, amount, status, provider_ref)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT DO NOTHING
                """)
                .params(UUID.randomUUID(), idempotencyKey, req.orderId(), req.amount(), status, charge.id())
                .update();
        return new Result(find(idempotencyKey).orElseThrow(), true);
    }

    /**
     * Applies a webhook once per event id. Updates the payment of that PaymentIntent, or creates it when
     * the charge went through but its answer never arrived (the caller timed out): the gap the webhook heals.
     * Returns false for a duplicate delivery.
     */
    @Transactional
    public boolean applyWebhook(String eventId, String type, String intentId, String status,
                                long amountInCents, Map<String, String> metadata) {
        int fresh = jdbc.sql("INSERT INTO stripe_events (id, type) VALUES (?, ?) ON CONFLICT DO NOTHING")
                .params(eventId, type).update();
        if (fresh == 0) {
            return false; // already processed: Stripe delivers at least once
        }
        int updated = jdbc.sql("UPDATE payments SET status = ? WHERE provider_ref = ?")
                .params(status, intentId).update();
        if (updated == 0 && metadata != null && metadata.containsKey("idempotency_key")) {
            jdbc.sql("""
                    INSERT INTO payments (id, idempotency_key, order_id, amount, status, provider_ref)
                    VALUES (?, ?, ?, ?, ?, ?)
                    ON CONFLICT DO NOTHING
                    """)
                    .params(UUID.randomUUID(), metadata.get("idempotency_key"), UUID.fromString(metadata.get("order_id")),
                            BigDecimal.valueOf(amountInCents).movePointLeft(2), status, intentId)
                    .update();
        }
        return true;
    }

    /** The payments of the last hours, with their provider reference: what reconciliation checks. */
    public List<PaymentOut> since(java.time.Duration window) {
        return jdbc.sql("""
                SELECT id, order_id, amount, status, provider_ref, created_at
                FROM payments WHERE created_at > now() - make_interval(secs => ?)
                ORDER BY created_at
                """)
                .param(window.toSeconds())
                .query(PaymentOut.class)
                .list();
    }

    private Optional<PaymentOut> find(String idempotencyKey) {
        return jdbc.sql("""
                SELECT id, order_id, amount, status, provider_ref, created_at
                FROM payments WHERE idempotency_key = ?
                """)
                .param(idempotencyKey)
                .query(PaymentOut.class)
                .optional();
    }
}
