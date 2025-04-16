package store.order;

import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;


/*
 * https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html
 */

@Repository
public interface OrderRepository extends CrudRepository<OrderModel, String> {

    
}
