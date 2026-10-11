package store.account;

import lombok.Builder;
import lombok.experimental.Accessors;

@Builder
@Accessors(fluent = true)
public record AccountOut(

    String id,
    String name,
    String email

) {
    
}
