package store.order;
import lombok.Builder;
import lombok.Data;
import lombok.experimental.Accessors;
import store.account.AccountOut;

import java.util.Date;
import java.util.List;

@Builder
@Data @Accessors(fluent = true)
public class Order {

    private String id;
    private Float total;
    private List<Item> items;
    private Date date;
    private AccountOut account;
    
}
