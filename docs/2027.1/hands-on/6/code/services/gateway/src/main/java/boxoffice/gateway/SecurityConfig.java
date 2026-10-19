package boxoffice.gateway;

import java.util.List;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.reactive.EnableWebFluxSecurity;
import org.springframework.security.config.web.server.ServerHttpSecurity;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusReactiveJwtDecoder;
import org.springframework.security.oauth2.jwt.ReactiveJwtDecoder;
import org.springframework.security.web.server.SecurityWebFilterChain;

@Configuration
@EnableWebFluxSecurity
public class SecurityConfig {

    /** Which routes are open, which need a valid token, which need the admin scope. */
    @Bean
    SecurityWebFilterChain security(ServerHttpSecurity http) {
        return http
                .csrf(ServerHttpSecurity.CsrfSpec::disable)        // stateless API, no cookies
                .authorizeExchange(ex -> ex
                        // open: getting a token, and the public keys to check one
                        .pathMatchers("/auth/register", "/auth/login", "/auth/.well-known/**").permitAll()
                        // open: browsing the catalog
                        .pathMatchers(HttpMethod.GET, "/catalog/**").permitAll()
                        // admin only: changing the catalog (scope claim "user admin")
                        .pathMatchers("/catalog/**").hasAuthority("SCOPE_admin")
                        // open: seat maps and availability (lab 6); holds need a token
                        .pathMatchers(HttpMethod.GET, "/inventory/events/**").permitAll()
                        // health, metrics, routes: the edge never forwards /actuator from outside
                        .pathMatchers("/actuator/**").permitAll()
                        // everything else (and every future route): any valid token
                        .anyExchange().authenticated())
                .oauth2ResourceServer(oauth -> oauth.jwt(Customizer.withDefaults()))
                .build();
    }

    /** Signature from the JWKS of auth, plus expiry, issuer and audience checks. */
    @Bean
    ReactiveJwtDecoder jwtDecoder(@Value("${spring.security.oauth2.resourceserver.jwt.jwk-set-uri}") String jwksUri,
                                  @Value("${jwt.issuer}") String issuer,
                                  @Value("${jwt.audience}") String audience) {
        var decoder = NimbusReactiveJwtDecoder.withJwkSetUri(jwksUri).build();
        decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
                JwtValidators.createDefaultWithIssuer(issuer),     // exp, nbf, iss
                new JwtClaimValidator<List<String>>("aud", aud -> aud != null && aud.contains(audience))));
        return decoder;
    }
}
