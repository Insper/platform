package boxoffice.catalog;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import java.math.BigDecimal;
import java.time.OffsetDateTime;

/** What a client sends to create or update an event. */
public record EventIn(
        @NotBlank @Size(max = 200) String title,
        @NotNull Category category,
        @NotNull Long venueId,
        @NotNull OffsetDateTime startsAt,
        @NotNull @PositiveOrZero BigDecimal priceFrom) {
}
