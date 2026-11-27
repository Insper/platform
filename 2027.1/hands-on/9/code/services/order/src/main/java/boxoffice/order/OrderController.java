package boxoffice.order;

import boxoffice.order.waitingroom.WaitingRoom;
import jakarta.validation.Valid;
import java.net.URI;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/orders")
public class OrderController {

    private final OrderService orders;
    private final WaitingRoom waitingRoom;

    public OrderController(OrderService orders, WaitingRoom waitingRoom) {
        this.orders = orders;
        this.waitingRoom = waitingRoom;
    }

    @PostMapping
    public ResponseEntity<OrderView> place(
            @Valid @RequestBody OrderRequest req,
            @RequestHeader(name = "X-Admission-Ticket", required = false) String ticket) {
        if (!waitingRoom.mayEnter(req.showId(), ticket)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,
                    "on-sale in progress: join /orders/waiting-room/" + req.showId() + "/join first");
        }
        OrderService.PlaceResult result = orders.place(req);
        if (!result.created()) {
            return ResponseEntity.ok(result.order());
        }
        return ResponseEntity.created(URI.create("/orders/" + result.order().id())).body(result.order());
    }

    @GetMapping("/{id}")
    public OrderView get(@PathVariable UUID id) {
        return orders.find(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
    }

    @PostMapping("/{id}/pay")
    public OrderView pay(@PathVariable UUID id) {
        return orders.pay(id);
    }
}
