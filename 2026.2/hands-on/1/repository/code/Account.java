package store.account;

import lombok.Builder;
import lombok.Data;
import lombok.experimental.Accessors;

@Builder @Data
@Accessors(fluent = true)
public class Account {

    private String id;
    private String name;
    private String email;
    private String password;
    private String hashPassword;
    
}
