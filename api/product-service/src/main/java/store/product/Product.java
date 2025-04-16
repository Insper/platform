package store.product;
import lombok.Builder;
import lombok.Data;
import lombok.experimental.Accessors;

@Builder
@Data @Accessors(fluent = true)
public class Product {

    private String id;
    private String name;
    private Float price;
    private String unit;
    
}
