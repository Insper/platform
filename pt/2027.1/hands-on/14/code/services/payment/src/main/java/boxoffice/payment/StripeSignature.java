package boxoffice.payment;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.HexFormat;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Checks the Stripe-Signature header of a webhook: t=<unix time>,v1=<hex HMAC-SHA256 of "t.body">.
 * Without it, anyone who finds the URL can post "payment succeeded".
 */
public final class StripeSignature {

    private StripeSignature() {
    }

    public static boolean valid(String body, String header, String secret, Duration tolerance, Clock clock) {
        if (header == null || secret == null || secret.isBlank()) {
            return false;
        }
        String timestamp = null;
        String expected = null;
        for (String part : header.split(",")) {
            String[] kv = part.split("=", 2);
            if (kv.length == 2 && kv[0].equals("t")) {
                timestamp = kv[1];
            } else if (kv.length == 2 && kv[0].equals("v1") && expected == null) {
                expected = kv[1];
            }
        }
        if (timestamp == null || expected == null) {
            return false;
        }
        long age = clock.instant().getEpochSecond() - Long.parseLong(timestamp);
        if (Math.abs(age) > tolerance.toSeconds()) {
            return false; // an old, replayed request: even with a correct signature
        }
        String computed = hmacSha256Hex(secret, timestamp + "." + body);
        // constant-time comparison: do not leak, byte by byte, how much of the signature matched
        return MessageDigest.isEqual(computed.getBytes(StandardCharsets.UTF_8), expected.getBytes(StandardCharsets.UTF_8));
    }

    static String hmacSha256Hex(String secret, String payload) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return HexFormat.of().formatHex(mac.doFinal(payload.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
