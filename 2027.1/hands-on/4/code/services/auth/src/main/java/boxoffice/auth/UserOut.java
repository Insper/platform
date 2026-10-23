package boxoffice.auth;

import java.util.UUID;

public record UserOut(UUID id, String name, String email, Role role) {

    static UserOut of(User u) {
        return new UserOut(u.getId(), u.getName(), u.getEmail(), u.getRole());
    }
}
