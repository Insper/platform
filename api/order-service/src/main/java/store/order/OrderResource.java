package store.order;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class OrderResource implements OrderController {

    @Autowired
    private OrderService orderService;


    @Override
    public ResponseEntity<OrderOut> create(OrderIn orderIn) {
        Order created = orderService.create(OrderParser.to(orderIn));
        return ResponseEntity.ok().body(OrderParser.to(created));
    }

    @Override
    public ResponseEntity<List<OrderOut>> findAll(){
        return ResponseEntity
            .ok()
            .body(orderService.findAll()
                .stream()
                .map(OrderParser::to)
                .toList());
    }


    @Override
    public ResponseEntity<OrderOut> findById(String id) {
        return ResponseEntity
            .ok()
            .body(OrderParser.to(orderService.findById(id)));
    }
    
}
