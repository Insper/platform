// Frameworks & Drivers layer — implements the AccountRepository port using Spring Data JPA.
// This is the only class that knows about JPA, AccountTable, and AccountMapper.
@Repository
public class AccountJpaAdapter implements AccountRepository {

    private final AccountJpaRepository jpa;

    public AccountJpaAdapter(AccountJpaRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public Optional<Account> findById(String id) {
        return jpa.findById(id).map(AccountMapper::toDomain);
    }

    @Override
    public Optional<Account> findByEmail(String email) {
        return jpa.findByEmail(email).map(AccountMapper::toDomain);
    }

    @Override
    public Account save(Account account) {
        AccountTable saved = jpa.save(AccountMapper.toTable(account));
        return AccountMapper.toDomain(saved);
    }

    @Override
    public void delete(String id) {
        jpa.deleteById(id);
    }
}

// Spring Data JPA interface — lives at the outermost layer
interface AccountJpaRepository extends JpaRepository<AccountTable, String> {
    Optional<AccountTable> findByEmail(String email);
}
