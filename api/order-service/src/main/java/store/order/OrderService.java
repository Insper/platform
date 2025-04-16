package store.order;
import java.util.List;
import java.util.stream.StreamSupport;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import store.product.ProductService.ProductResource;

@Service
public class OrderService {

    @Autowired
    private OrderRepository orderRepository;

    @Autowired
    private ProductResource productResource;

    
    
    public Order create(Order order) {
        order.items().forEach(p -> {
            Product prod = findById(p.product().id());
            
        });

        return orderRepository.save(new OrderModel(order)).to();
    }

    public Order findById(String id) {
        
        return orderRepository.findById(id).get().to();
    }

    public List<Order> findAll() {
        return StreamSupport
            .stream(orderRepository.findAll().spliterator(), false)
            .map(OrderModel::to)
            .toList();
    }


}
