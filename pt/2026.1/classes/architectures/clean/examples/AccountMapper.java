// Frameworks & Drivers layer — converts between domain objects and persistence objects.
// The boundary between Use Cases and Frameworks & Drivers layers.
public final class AccountMapper {

    private AccountMapper() {}

    public static Account toDomain(AccountTable table) {
        return Account.reconstruct(
            table.getId(),
            table.getName(),
            table.getEmail(),
            table.getPasswordHash()
        );
    }

    public static AccountTable toTable(Account account) {
        return new AccountTable(
            account.id(),
            account.name(),
            account.email(),
            account.passwordHash()
        );
    }
}
