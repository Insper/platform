package boxoffice.inventory;

import jakarta.validation.constraints.NotEmpty;
import jakarta.validation.constraints.NotNull;
import java.util.List;

public record HoldIn(@NotNull Long eventId, @NotEmpty List<@NotNull Long> seatIds) {
}
