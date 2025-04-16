package store.order;


import lombok.Builder;
import lombok.experimental.Accessors;
import store.product.ProductOut;

@Builder @Accessors(fluent = true)
public record ItemOut(
    String id,
    ProductOut product,
    int quantity,
    Float total
) {
}
