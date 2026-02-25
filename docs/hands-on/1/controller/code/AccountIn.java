package store.account;

import lombok.Builder;

@Builder
public record AccountIn(

    String name,
    String email,
    String password

) {

}
