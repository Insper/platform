package boxoffice.payment;

import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;
import tools.jackson.databind.ObjectMapper;

/** Stripe tells us what happened, later and maybe twice: the webhook is the source of truth. */
@RestController
@ConditionalOnProperty(name = "boxoffice.psp.provider", havingValue = "stripe")
public class StripeWebhookController {

    private static final Logger log = LoggerFactory.getLogger(StripeWebhookController.class);

    record Event(String id, String type, Data data) {
        record Data(Intent object) {
        }

        record Intent(String id, String status, long amount, Map<String, String> metadata) {
        }
    }

    private final PaymentService payments;
    private final ObjectMapper json;
    private final String secret;
    private final Duration tolerance;
    private final Clock clock = Clock.systemUTC();

    public StripeWebhookController(PaymentService payments, ObjectMapper json,
                                   @Value("${boxoffice.stripe.webhook-secret}") String secret,
                                   @Value("${boxoffice.stripe.tolerance}") Duration tolerance) {
        this.payments = payments;
        this.json = json;
        this.secret = secret;
        this.tolerance = tolerance;
    }

    /** The raw body, as a String: the signature is computed over the exact bytes Stripe sent. */
    @PostMapping("/webhooks/stripe")
    public ResponseEntity<String> receive(@RequestBody String body,
                                          @RequestHeader(value = "Stripe-Signature", required = false) String signature) {
        if (!StripeSignature.valid(body, signature, secret, tolerance, clock)) {
            log.warn("webhook rejected: bad or missing Stripe-Signature");
            return ResponseEntity.badRequest().body("bad signature");
        }
        Event event = json.readValue(body, Event.class);
        String status = switch (event.type()) {
            case "payment_intent.succeeded" -> "AUTHORIZED";
            case "payment_intent.payment_failed" -> "DECLINED";
            default -> null; // other events: acknowledged, ignored
        };
        if (status == null) {
            return ResponseEntity.ok("ignored");
        }
        Event.Intent intent = event.data().object();
        boolean applied = payments.applyWebhook(event.id(), event.type(), intent.id(), status, intent.amount(), intent.metadata());
        log.info("webhook {} {} {} → {}", event.id(), event.type(), intent.id(), applied ? status : "duplicate, skipped");
        return ResponseEntity.ok(applied ? "applied" : "duplicate"); // 2xx quickly, or Stripe retries
    }
}
