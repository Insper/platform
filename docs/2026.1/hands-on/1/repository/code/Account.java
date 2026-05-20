package store.account;

import lombok.Builder;
import lombok.Data;
import lombok.experimental.Accessors;

@Data
@Builder @Accessors(chain = true, fluent = true)
public class Account {

    private String id;
    private String name;
    private String email;
    private String password;
    private String passwordSha256;
    
}
