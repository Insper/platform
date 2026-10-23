package boxoffice.payment;

import java.math.BigDecimal;
import java.time.Duration;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

@Component
public class PspClient {

    record ChargeBody(BigDecimal amount, String currency, String reference) {
    }

    record Charge(String id, String status) {
    }

    private final RestClient http;

    public PspClient(RestClient.Builder builder,
                     @Value("${boxoffice.psp.url}") String url,
                     @Value("${boxoffice.psp.connect-timeout}") Duration connectTimeout,
                     @Value("${boxoffice.psp.read-timeout}") Duration readTimeout) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeout); // time to open the TCP connection
        factory.setReadTimeout(readTimeout);       // max silence while waiting for the response
        this.http = builder.baseUrl(url).requestFactory(factory).build();
    }

    /** The provider deduplicates by Idempotency-Key, like real PSPs do. */
    public Charge charge(String idempotencyKey, BigDecimal amount, String reference) {
        return http.post()
                .uri("/v1/charges")
                .header("Idempotency-Key", idempotencyKey)
                .body(new ChargeBody(amount, "BRL", reference))
                .retrieve()
                .body(Charge.class);
    }
}
