package boxoffice.inventory;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

public record HoldOut(UUID id, Long eventId, String status, OffsetDateTime expiresAt, List<Long> seatIds) {
}
