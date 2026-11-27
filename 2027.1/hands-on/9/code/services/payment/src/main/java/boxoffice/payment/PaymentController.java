package boxoffice.payment;

import jakarta.validation.Valid;
import java.net.URI;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/payments")
public class PaymentController {

    private final PaymentService payments;

    public PaymentController(PaymentService payments) {
        this.payments = payments;
    }

    @PostMapping
    public ResponseEntity<PaymentOut> charge(@RequestHeader("Idempotency-Key") String idempotencyKey,
                                             @Valid @RequestBody ChargeRequest req) {
        PaymentService.Result r = payments.charge(idempotencyKey, req);
        return r.created()
                ? ResponseEntity.created(URI.create("/payments/" + r.payment().id())).body(r.payment())
                : ResponseEntity.ok(r.payment());
    }
}
