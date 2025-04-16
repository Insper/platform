package store.order;

import lombok.Builder;
import lombok.experimental.Accessors;

@Builder @Accessors(fluent = true)
public record ItemIn(
    String id,
    int quantity,
    String id_product
) {
    
}
