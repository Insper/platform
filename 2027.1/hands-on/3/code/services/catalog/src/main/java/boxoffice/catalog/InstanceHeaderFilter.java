package boxoffice.catalog;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Adds "X-Instance: catalog-2" to every response: which replica answered? */
@Component
public class InstanceHeaderFilter extends OncePerRequestFilter {

    // Docker sets HOSTNAME to the container's hostname (catalog-1, catalog-2, ...)
    private final String instance = System.getenv().getOrDefault("HOSTNAME", "local");

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        response.setHeader("X-Instance", instance);
        chain.doFilter(request, response);
    }
}
