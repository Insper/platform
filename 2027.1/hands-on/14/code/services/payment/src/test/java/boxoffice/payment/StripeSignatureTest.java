package boxoffice.payment;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

class StripeSignatureTest {

    static final String SECRET = "whsec_test_secret";
    static final String BODY = "{\"id\":\"evt_1\",\"type\":\"payment_intent.succeeded\"}";
    static final long T = 1_800_000_000L;
    static final Clock NOW = Clock.fixed(Instant.ofEpochSecond(T + 10), ZoneOffset.UTC);
    static final Duration TOLERANCE = Duration.ofSeconds(300);

    static String header(long t, String body, String secret) {
        return "t=" + t + ",v1=" + StripeSignature.hmacSha256Hex(secret, t + "." + body);
    }

    @Test
    void acceptsTheSignatureStripeComputes() {
        assertTrue(StripeSignature.valid(BODY, header(T, BODY, SECRET), SECRET, TOLERANCE, NOW));
    }

    @Test
    void rejectsAnEditedBody() {
        assertFalse(StripeSignature.valid(BODY.replace("succeeded", "failed"), header(T, BODY, SECRET), SECRET, TOLERANCE, NOW));
    }

    @Test
    void rejectsAnotherSecret() {
        assertFalse(StripeSignature.valid(BODY, header(T, BODY, "whsec_other"), SECRET, TOLERANCE, NOW));
    }

    @Test
    void rejectsAnOldSignature() {
        long old = T - 600; // ten minutes before NOW: a replayed request
        assertFalse(StripeSignature.valid(BODY, header(old, BODY, SECRET), SECRET, TOLERANCE, NOW));
    }

    @Test
    void rejectsAMissingHeader() {
        assertFalse(StripeSignature.valid(BODY, null, SECRET, TOLERANCE, NOW));
    }
}
