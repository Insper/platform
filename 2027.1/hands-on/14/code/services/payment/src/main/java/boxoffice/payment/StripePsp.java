package boxoffice.payment;

import java.math.BigDecimal;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.MediaType;
import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;

/** The Stripe sandbox: one PaymentIntent per order, created and confirmed on the server. */
@Component
@ConditionalOnProperty(name = "boxoffice.psp.provider", havingValue = "stripe")
public class StripePsp implements Psp {

    /** The fields of a PaymentIntent this service reads. */
    record Intent(String id, String status) {
    }

    /** Stripe's error body: a declined card comes back as HTTP 402 with type card_error. */
    record ErrorBody(Error error) {
        record Error(String type, String code, String decline_code, String message, Intent payment_intent) {
        }
    }

    private final RestClient http;
    private final String currency;
    private final String defaultMethod;

    public StripePsp(RestClient.Builder builder,
                     @Value("${boxoffice.stripe.url}") String url,
                     @Value("${boxoffice.stripe.secret-key}") String secretKey,
                     @Value("${boxoffice.stripe.currency}") String currency,
                     @Value("${boxoffice.stripe.payment-method}") String defaultMethod,
                     @Value("${boxoffice.psp.connect-timeout}") Duration connectTimeout,
                     @Value("${boxoffice.psp.read-timeout}") Duration readTimeout) {
        if (!secretKey.startsWith("sk_test_")) {
            // a live key (sk_live_…) moves real money: this lab refuses to start with one
            throw new IllegalStateException("STRIPE_SECRET_KEY must be a test key (sk_test_…)");
        }
        // the JDK HttpClient keeps the body of an error answer (HttpURLConnection may drop it)
        JdkClientHttpRequestFactory factory = new JdkClientHttpRequestFactory(
                HttpClient.newBuilder().connectTimeout(connectTimeout).build());
        factory.setReadTimeout(readTimeout);
        this.http = builder.baseUrl(url)
                .defaultHeader("Authorization", "Bearer " + secretKey)
                .requestFactory(factory)
                .build();
        this.currency = currency;
        this.defaultMethod = defaultMethod;
    }

    @Override
    public Charge charge(String idempotencyKey, BigDecimal amount, UUID orderId, String paymentMethod) {
        MultiValueMap<String, String> form = new LinkedMultiValueMap<>();
        form.add("amount", String.valueOf(amount.movePointRight(2).longValueExact())); // centavos
        form.add("currency", currency);
        form.add("payment_method", paymentMethod != null ? paymentMethod : defaultMethod);
        form.add("confirm", "true");                                   // charge now, on the server
        form.add("automatic_payment_methods[enabled]", "true");
        form.add("automatic_payment_methods[allow_redirects]", "never"); // no browser to redirect
        form.add("metadata[order_id]", orderId.toString());
        form.add("metadata[idempotency_key]", idempotencyKey);         // lets a webhook find the payment
        return http.post()
                .uri("/v1/payment_intents")
                .header("Idempotency-Key", idempotencyKey)             // Stripe charges once per key
                .contentType(MediaType.APPLICATION_FORM_URLENCODED)
                .body(form)
                .exchange((request, response) -> {
                    if (response.getStatusCode().is2xxSuccessful()) {
                        Intent intent = response.bodyTo(Intent.class);
                        return new Charge(intent.id(), "succeeded".equals(intent.status()));
                    }
                    ErrorBody body = response.bodyTo(ErrorBody.class);
                    if (response.getStatusCode().value() == 402 && body != null && body.error().payment_intent() != null) {
                        return new Charge(body.error().payment_intent().id(), false); // declined: an answer, not a failure
                    }
                    String message = body != null ? body.error().message() : response.getStatusText();
                    throw new IllegalStateException("Stripe answered " + response.getStatusCode().value() + ": " + message);
                });
    }

    /** The provider's view of one PaymentIntent: the source of truth for reconciliation. */
    public Intent retrieve(String intentId) {
        return http.get().uri("/v1/payment_intents/{id}", intentId).retrieve().body(Intent.class);
    }
}
