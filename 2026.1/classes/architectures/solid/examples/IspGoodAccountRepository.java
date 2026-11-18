// Segregated interfaces: each client depends only on what it actually uses.

public interface AccountReader {
    Optional<Account> findById(String id);
    Optional<Account> findByEmail(String email);
    List<Account> findAll();
}

public interface AccountWriter {
    Account save(Account account);
    void delete(String id);
}

public interface AccountAdmin extends AccountReader {
    List<Account> findByRole(String role);
    void bulkImport(List<Account> accounts);
}

// AccountService depends only on what it needs — no unused methods.
public class AccountService {
    private final AccountReader reader;
    private final AccountWriter writer;

    public AccountService(AccountReader reader, AccountWriter writer) {
        this.reader = reader;
        this.writer = writer;
    }

    public Account findById(String id) {
        return reader.findById(id).orElseThrow(AccountNotFoundException::new);
    }

    public Account save(Account account) {
        return writer.save(account);
    }
}

// The JPA adapter implements all interfaces — no behaviour is lost.
class JpaAccountAdapter implements AccountReader, AccountWriter, AccountAdmin {
    // single implementation, multiple interfaces
}
