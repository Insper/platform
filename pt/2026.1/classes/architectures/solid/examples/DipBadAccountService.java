// VIOLATION: high-level module directly instantiates a low-level module.
// Swapping the persistence mechanism requires modifying AccountService.
public class AccountService {

    // Direct dependency on a concrete class — impossible to substitute in tests
    private final MySqlAccountRepository repository = new MySqlAccountRepository();

    public Account findById(String id) {
        return repository.findById(id);
    }

    public Account create(AccountIn in) {
        Account account = Account.of(in);
        repository.save(account);
        return account;
    }
}

// Concrete low-level module
class MySqlAccountRepository {
    public Account findById(String id) { /* SQL query */ return null; }
    public void save(Account account)  { /* SQL insert */ }
}
