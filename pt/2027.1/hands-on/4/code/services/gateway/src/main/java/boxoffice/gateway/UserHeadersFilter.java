package boxoffice.gateway;

import org.springframework.cloud.gateway.filter.GatewayFilterChain;
import org.springframework.cloud.gateway.filter.GlobalFilter;
import org.springframework.core.Ordered;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import reactor.core.publisher.Mono;

/**
 * Tells the services who the user is: X-User-Id, X-User-Email, X-User-Scope.
 * Headers with these names coming from the client are always removed first,
 * otherwise anyone could claim to be anyone.
 */
@Component
public class UserHeadersFilter implements GlobalFilter, Ordered {

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, GatewayFilterChain chain) {
        var cleaned = exchange.mutate()
                .request(r -> r.headers(h -> {
                    h.remove("X-User-Id");
                    h.remove("X-User-Email");
                    h.remove("X-User-Scope");
                }))
                .build();
        return ReactiveSecurityContextHolder.getContext()
                .map(SecurityContext::getAuthentication)
                .filter(JwtAuthenticationToken.class::isInstance)
                .cast(JwtAuthenticationToken.class)
                .map(auth -> cleaned.mutate()
                        .request(r -> r.headers(h -> {
                            var jwt = auth.getToken();
                            h.set("X-User-Id", jwt.getSubject());
                            h.set("X-User-Email", jwt.getClaimAsString("email"));
                            h.set("X-User-Scope", jwt.getClaimAsString("scope"));
                        }))
                        .build())
                .defaultIfEmpty(cleaned)          // anonymous request on an open route
                .flatMap(chain::filter);
    }

    @Override
    public int getOrder() {
        return Ordered.HIGHEST_PRECEDENCE;
    }
}
