// Test adapter — in-memory implementation of the AccountRepository secondary port.
// Used in unit tests to drive the core without any infrastructure.
public class InMemoryAccountRepository implements AccountRepository {

    private final Map<String, Account> byId    = new HashMap<>();
    private final Map<String, Account> byEmail = new HashMap<>();

    @Override
    public Optional<Account> findByEmail(String email) {
        return Optional.ofNullable(byEmail.get(email));
    }

    @Override
    public Optional<Account> findById(String id) {
        return Optional.ofNullable(byId.get(id));
    }

    @Override
    public Account save(Account account) {
        byId.put(account.id(), account);
        byEmail.put(account.email(), account);
        return account;
    }
}
