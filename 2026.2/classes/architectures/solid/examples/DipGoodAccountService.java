// Abstraction — defined by the high-level module, implemented by the low-level module.
public interface AccountRepository {
    Optional<Account> findById(String id);
    Account save(Account account);
}

// High-level module depends on the abstraction, not on a concrete class.
// The implementation is injected at runtime by the DI container (Spring).
public class AccountService {

    private final AccountRepository repository;

    public AccountService(AccountRepository repository) {
        this.repository = repository;
    }

    public Account findById(String id) {
        return repository.findById(id)
            .orElseThrow(AccountNotFoundException::new);
    }

    public Account create(AccountIn in) {
        return repository.save(Account.of(in));
    }
}

// Low-level module also depends on the abstraction.
@Repository
public class JpaAccountRepository implements AccountRepository {

    private final AccountJpaRepository jpa;

    public JpaAccountRepository(AccountJpaRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public Optional<Account> findById(String id) {
        return jpa.findById(id).map(AccountMapper::toDomain);
    }

    @Override
    public Account save(Account account) {
        return AccountMapper.toDomain(jpa.save(AccountMapper.toTable(account)));
    }
}
