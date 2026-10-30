package boxoffice.auth;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JOSEObjectType;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.RSASSASigner;
import com.nimbusds.jose.jwk.JWKSet;
import com.nimbusds.jose.jwk.KeyUse;
import com.nimbusds.jose.jwk.RSAKey;
import com.nimbusds.jose.jwk.gen.RSAKeyGenerator;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Signs JWTs with a private RSA key (RS256) and publishes the public key as a JWKS.
 * Only auth holds the private key; anyone can verify a token with the public one.
 */
@Component
public class TokenService {

    private final RSAKey key;
    private final String issuer;
    private final String audience;
    private final Duration ttl;

    public TokenService(@Value("${jwt.issuer}") String issuer,
                        @Value("${jwt.audience}") String audience,
                        @Value("${jwt.ttl}") Duration ttl) throws JOSEException {
        // a new key pair at every start: fine for a lab, see the warning in the text
        this.key = new RSAKeyGenerator(2048)
                .keyID(UUID.randomUUID().toString())
                .keyUse(KeyUse.SIGNATURE)
                .algorithm(JWSAlgorithm.RS256)
                .generate();
        this.issuer = issuer;
        this.audience = audience;
        this.ttl = ttl;
    }

    public TokenOut issue(User user) {
        var now = Instant.now();
        var claims = new JWTClaimsSet.Builder()
                .issuer(issuer)
                .audience(audience)
                .subject(user.getId().toString())
                .claim("email", user.getEmail())
                .claim("name", user.getName())
                .claim("scope", user.getRole() == Role.ADMIN ? "user admin" : "user")
                .issueTime(Date.from(now))
                .expirationTime(Date.from(now.plus(ttl)))
                .jwtID(UUID.randomUUID().toString())
                .build();
        var header = new JWSHeader.Builder(JWSAlgorithm.RS256)
                .keyID(key.getKeyID())
                .type(JOSEObjectType.JWT)
                .build();
        try {
            var jwt = new SignedJWT(header, claims);
            jwt.sign(new RSASSASigner(key));
            return new TokenOut(jwt.serialize(), "Bearer", ttl.toSeconds());
        } catch (JOSEException e) {
            throw new IllegalStateException("could not sign the token", e);
        }
    }

    /** The public part only: {"keys":[{"kty":"RSA","kid":"...","n":"...","e":"AQAB",...}]} */
    public Map<String, Object> jwks() {
        return new JWKSet(key.toPublicJWK()).toJSONObject();
    }
}
