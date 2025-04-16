package store.product;
import java.util.List;
import java.util.stream.StreamSupport;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class ProductService {

    @Autowired
    private ProductRepository productRepository;
    
    public Product create(Product product) {

        return productRepository.save(new ProductModel(product)).to();
    }

    public Product findById(String id) {
        return productRepository.findById(id).get().to();
    }

    public List<Product> findAll() {
        return StreamSupport
            .stream(productRepository.findAll().spliterator(), false)
            .map(ProductModel::to)
            .toList();
    }

    public Product deleteById(String id) {
        ProductModel m = productRepository.findById(id).get();
        productRepository.delete(m);
        return m.to();
    }

}
