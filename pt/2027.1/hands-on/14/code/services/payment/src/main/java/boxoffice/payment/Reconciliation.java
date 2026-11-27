package boxoffice.payment;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Compares our payments with Stripe's PaymentIntents: what the provider says wins. */
@RestController
@ConditionalOnProperty(name = "boxoffice.psp.provider", havingValue = "stripe")
public class Reconciliation {

    record Mismatch(String providerRef, String ours, String stripe) {
    }

    record Report(int checked, List<Mismatch> mismatches) {
    }

    private final PaymentService payments;
    private final StripePsp stripe;

    public Reconciliation(PaymentService payments, StripePsp stripe) {
        this.payments = payments;
        this.stripe = stripe;
    }

    @GetMapping("/payments/reconcile")
    public Report reconcile(@RequestParam(defaultValue = "PT1H") Duration window) {
        List<PaymentOut> ours = payments.since(window);
        List<Mismatch> mismatches = new ArrayList<>();
        for (PaymentOut p : ours) {
            if (p.providerRef() == null || !p.providerRef().startsWith("pi_")) {
                continue; // not a Stripe payment (lab 9's fake provider)
            }
            String theirs;
            try {
                theirs = stripe.retrieve(p.providerRef()).status();
            } catch (HttpClientErrorException.NotFound e) {
                theirs = "missing"; // a payment Stripe never made: the worst mismatch
            }
            String expected = switch (theirs) {
                case "succeeded" -> "AUTHORIZED";
                case "requires_payment_method", "canceled" -> "DECLINED";
                default -> null; // processing, requires_action, missing…: always worth a look
            };
            if (!p.status().equals(expected)) {
                mismatches.add(new Mismatch(p.providerRef(), p.status(), theirs));
            }
        }
        return new Report(ours.size(), mismatches);
    }
}
