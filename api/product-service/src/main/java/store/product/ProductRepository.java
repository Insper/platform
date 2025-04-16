package store.product;

import org.springframework.data.repository.CrudRepository;
import org.springframework.stereotype.Repository;


/*
 * https://docs.spring.io/spring-data/jpa/reference/jpa/query-methods.html
 */

@Repository
public interface ProductRepository extends CrudRepository<ProductModel, String> {

    
}
