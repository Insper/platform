package store.order;
import lombok.Builder;
import lombok.Data;
import lombok.experimental.Accessors;
import store.product.ProductOut;

@Builder
@Data @Accessors(fluent = true)
public class Item {

    private String id;
    private int quantity;
    private Float total;
    private ProductOut product;

}
