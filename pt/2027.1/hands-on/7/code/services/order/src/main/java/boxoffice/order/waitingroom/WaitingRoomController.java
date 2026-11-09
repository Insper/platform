package boxoffice.order.waitingroom;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/orders/waiting-room/{showId}")
public class WaitingRoomController {

    private final WaitingRoom room;

    public WaitingRoomController(WaitingRoom room) {
        this.room = room;
    }

    /** Operator endpoints: in production, protect them (admin role at the gateway). */
    @PostMapping("/open")
    public ResponseEntity<Void> open(@PathVariable String showId) {
        room.open(showId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/close")
    public ResponseEntity<Void> close(@PathVariable String showId) {
        room.close(showId);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/join")
    public ResponseEntity<Ticket> join(@PathVariable String showId) {
        return ResponseEntity.status(HttpStatus.ACCEPTED).body(room.join(showId));
    }

    @GetMapping("/tickets/{ticketId}")
    public ResponseEntity<Ticket> ticket(@PathVariable String showId, @PathVariable String ticketId) {
        Ticket t = room.status(showId, ticketId);
        return "UNKNOWN".equals(t.status()) ? ResponseEntity.status(HttpStatus.NOT_FOUND).body(t)
                                            : ResponseEntity.ok(t);
    }
}
