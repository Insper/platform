package boxoffice.payment;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

@Service
public class PaymentService {

    public record Result(PaymentOut payment, boolean created) {
    }

    private final JdbcClient jdbc;
    private final PspClient psp;

    public PaymentService(JdbcClient jdbc, PspClient psp) {
        this.jdbc = jdbc;
        this.psp = psp;
    }

    public Result charge(String idempotencyKey, ChargeRequest req) {
        Optional<PaymentOut> done = find(idempotencyKey);
        if (done.isPresent()) {
            return new Result(done.get(), false); // a retry: answer, do not charge again
        }
        // remote call OUTSIDE any database transaction: never hold a connection while waiting
        PspClient.Charge charge = psp.charge(idempotencyKey, req.amount(), "order-" + req.orderId());
        String status = "approved".equals(charge.status()) ? "AUTHORIZED" : "DECLINED";
        jdbc.sql("""
                INSERT INTO payments (id, idempotency_key, order_id, amount, status, provider_ref)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (idempotency_key) DO NOTHING
                """)
                .params(UUID.randomUUID(), idempotencyKey, req.orderId(), req.amount(), status, charge.id())
                .update();
        return new Result(find(idempotencyKey).orElseThrow(), true);
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
