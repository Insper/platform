package boxoffice.auth;

import jakarta.validation.constraints.NotBlank;

public record LoginIn(@NotBlank String email, @NotBlank String password) {
}
