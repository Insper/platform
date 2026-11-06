package boxoffice.auth;

import jakarta.validation.Valid;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService service;
    private final TokenService tokens;

    public AuthController(AuthService service, TokenService tokens) {
        this.service = service;
        this.tokens = tokens;
    }

    @PostMapping("/register")
    @ResponseStatus(HttpStatus.CREATED)
    public UserOut register(@Valid @RequestBody RegisterIn in) {
        return service.register(in);
    }

    @PostMapping("/login")
    public TokenOut login(@Valid @RequestBody LoginIn in) {
        return service.login(in);
    }

    /** Protected route: the gateway validated the JWT and tells us who the user is. */
    @GetMapping("/me")
    public UserOut me(@RequestHeader("X-User-Id") UUID userId) {
        return service.find(userId);
    }

    @GetMapping("/.well-known/jwks.json")
    public Map<String, Object> jwks() {
        return tokens.jwks();
    }
}
