package store.account;

import java.util.List;

public class AccountParser {

    public static AccountOut to(Account in) {
        return in == null ? null :
            AccountOut.builder()
                .id(in.id())
                .name(in.name())
                .email(in.email())
                .build();
    }
    
    public static List<AccountOut> to(List<Account> l) {
        return l.stream().map(AccountParser::to).toList();
    }
}
