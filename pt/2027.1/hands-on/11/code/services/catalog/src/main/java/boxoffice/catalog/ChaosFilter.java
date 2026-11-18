package boxoffice.catalog;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Lab 11 only: CHAOS_ERROR_RATE=0.2 makes 20% of the API requests fail, to play a bad release. */
@Component
public class ChaosFilter extends OncePerRequestFilter {

    private final double errorRate;

    public ChaosFilter(@Value("${CHAOS_ERROR_RATE:0}") double errorRate) {
        this.errorRate = errorRate;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return errorRate <= 0 || request.getRequestURI().startsWith("/actuator");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (ThreadLocalRandom.current().nextDouble() < errorRate) {
            response.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR, "injected failure");
            return;
        }
        chain.doFilter(request, response);
    }
}
