package boxoffice.payment;

import java.math.BigDecimal;
import java.time.Duration;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/** Lab 9's fake provider (WireMock behind Toxiproxy): still the default, so the chaos experiments keep working. */
@Component
@ConditionalOnProperty(name = "boxoffice.psp.provider", havingValue = "fake", matchIfMissing = true)
public class PspClient implements Psp {

    record ChargeBody(BigDecimal amount, String currency, String reference) {
    }

    record ChargeOut(String id, String status) {
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
    @Override
    public Charge charge(String idempotencyKey, BigDecimal amount, UUID orderId, String paymentMethod) {
        ChargeOut out = http.post()
                .uri("/v1/charges")
                .header("Idempotency-Key", idempotencyKey)
                .body(new ChargeBody(amount, "BRL", "order-" + orderId))
                .retrieve()
                .body(ChargeOut.class);
        return new Charge(out.id(), "approved".equals(out.status()));
    }
}
