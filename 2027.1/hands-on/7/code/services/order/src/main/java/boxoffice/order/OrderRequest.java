package boxoffice.order;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.math.BigDecimal;

public record OrderRequest(
        @NotBlank String showId,
        @NotBlank String holdId,
        @NotBlank @Email String customerEmail,
        @NotNull @Positive BigDecimal amount) {
}
