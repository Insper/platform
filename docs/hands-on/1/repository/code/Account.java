package store.account;

import java.util.List;

import lombok.Builder;
import lombok.Data;
import lombok.experimental.Accessors;

@Data @Builder
@Accessors(fluent = true)
public class Account {

    private String id;
    private String name;
    private String email;
    private String password;
    
}
