package store.account;

import lombok.Builder;
import lombok.experimental.Accessors;

@Builder
@Accessors(fluent = true)
public record AccountIn(

    String name,
    String email,
    String password

) {
    
}
