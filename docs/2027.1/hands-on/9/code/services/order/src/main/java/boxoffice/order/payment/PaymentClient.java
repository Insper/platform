package boxoffice.order.payment;

import java.time.Duration;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class PaymentClient {

    private final RestClient http;

    public PaymentClient(RestClient.Builder builder,
                         @Value("${boxoffice.payment.url}") String url,
                         @Value("${boxoffice.payment.connect-timeout}") Duration connectTimeout,
                         @Value("${boxoffice.payment.read-timeout}") Duration readTimeout) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeout);
        factory.setReadTimeout(readTimeout); // 0 = wait forever (the "before" experiment)
        this.http = builder.baseUrl(url).requestFactory(factory).build();
    }

    public PaymentResponse charge(UUID orderId, java.math.BigDecimal amount) {
        return http.post()
                .uri("/payments")
                .header("Idempotency-Key", "order-" + orderId) // same key on every retry
                .body(new PaymentRequest(orderId, amount))
                .retrieve()
                .body(PaymentResponse.class);
    }
}
