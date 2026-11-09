package boxoffice.inventory;

import jakarta.validation.Valid;
import java.net.URI;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/inventory")
public class InventoryController {

    private final SeatQueries queries;
    private final HoldService holds;

    public InventoryController(SeatQueries queries, HoldService holds) {
        this.queries = queries;
        this.holds = holds;
    }

    // ---- open (GET, through the gateway without a token), served by the replica ----

    @GetMapping("/events/{eventId}/availability")
    public List<SectionAvailability> availability(@PathVariable long eventId) {
        return queries.availability(eventId);
    }

    @GetMapping("/events/{eventId}/seats")
    public List<SeatOut> seats(@PathVariable long eventId, @RequestParam String section) {
        return queries.seats(eventId, section);
    }

    // ---- protected: the gateway sets X-User-Id from the JWT ----

    @PostMapping("/holds")
    public ResponseEntity<HoldOut> hold(@RequestHeader("X-User-Id") String userId, @Valid @RequestBody HoldIn in) {
        var out = holds.hold(userId, in);
        return ResponseEntity.created(URI.create("/inventory/holds/" + out.id())).body(out);
    }

    @GetMapping("/holds/{id}")
    public HoldOut find(@RequestHeader("X-User-Id") String userId, @PathVariable UUID id) {
        return holds.find(userId, id);
    }

    @PostMapping("/holds/{id}/confirm")
    public HoldOut confirm(@RequestHeader("X-User-Id") String userId, @PathVariable UUID id) {
        return holds.confirm(userId, id);
    }

    @DeleteMapping("/holds/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void release(@RequestHeader("X-User-Id") String userId, @PathVariable UUID id) {
        holds.release(userId, id);
    }

    /** The invariant check used after a flash-sale test: must be {"doubleBookedSeats": 0}. */
    @GetMapping("/audit/double-bookings")
    public Map<String, Long> audit() {
        return Map.of("doubleBookedSeats", queries.doubleBookedSeats());
    }
}
