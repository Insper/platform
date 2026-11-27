package boxoffice.catalog;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record VenueIn(
        @NotBlank @Size(max = 200) String name,
        @NotBlank @Size(max = 100) String city,
        @Positive int capacity) {
}
