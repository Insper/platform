package boxoffice.auth;

import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

@Service
public class AuthService {

    private static final Logger log = LoggerFactory.getLogger(AuthService.class);

    private final UserRepository users;
    private final TokenService tokens;
    // cost 10 = 2^10 rounds: deliberately slow (tens of ms) to make password guessing expensive
    private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(10);
    private final String adminEmail;
    private final String adminPassword;

    public AuthService(UserRepository users, TokenService tokens,
                       @Value("${admin.email}") String adminEmail,
                       @Value("${admin.password}") String adminPassword) {
        this.users = users;
        this.tokens = tokens;
        this.adminEmail = adminEmail;
        this.adminPassword = adminPassword;
    }

    @Transactional
    public UserOut register(RegisterIn in) {
        var email = in.email().toLowerCase();
        if (users.existsByEmail(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "e-mail already registered");
        }
        var user = users.save(new User(email, in.name(), encoder.encode(in.password()), Role.USER));
        return UserOut.of(user);
    }

    @Transactional(readOnly = true)
    public TokenOut login(LoginIn in) {
        var user = users.findByEmail(in.email().toLowerCase())
                .filter(u -> encoder.matches(in.password(), u.getPasswordHash()))
                // same answer for "no such user" and "wrong password": do not help attackers
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "invalid credentials"));
        return tokens.issue(user);
    }

    @Transactional(readOnly = true)
    public UserOut find(UUID id) {
        return users.findById(id).map(UserOut::of)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "user not found"));
    }

    /** Creates the administrator on the first start (credentials from ADMIN_EMAIL / ADMIN_PASSWORD). */
    @EventListener(ApplicationReadyEvent.class)
    @Transactional
    public void createAdmin() {
        if (!users.existsByEmail(adminEmail)) {
            users.save(new User(adminEmail, "Administrator", encoder.encode(adminPassword), Role.ADMIN));
            log.info("created administrator {}", adminEmail);
        }
    }
}
