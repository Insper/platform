package store.order;

import lombok.Builder;
import lombok.experimental.Accessors;
import java.util.List;

@Builder @Accessors(fluent = true)
public record OrderIn(
    List<ItemIn> items
) {
    
}
