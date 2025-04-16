package store.order;


import lombok.Builder;
import lombok.experimental.Accessors;

import java.util.Date;
import java.util.List;

@Builder @Accessors(fluent = true)
public record OrderOut(
    String id,
    Date date,
    List<ItemOut> items,
    Float total
) {
}
