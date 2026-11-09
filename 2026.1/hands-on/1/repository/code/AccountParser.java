package store.account;

import java.util.List;

public class AccountParser {

    public static AccountOut to(Account a) {
        return a == null ? null :
            AccountOut.builder()
                .id(a.id())
                .name(a.name())
                .email(a.email())
                .build();
    }
    
    public static List<AccountOut> to(List<Account> l) {
        return l.stream().map(AccountParser::to).toList();
    }

    public static Account to(AccountIn in) {
        return in == null ? null :
            Account.builder()
                .name(in.name())
                .email(in.email())
                .password(in.password())
                .build();
    }

}
