// Driven adapter — implements the AccountRepository secondary port using JPA.
// Lives outside the hexagon. The core never imports this class.
@Repository
public class AccountJpaAdapter implements AccountRepository {

    private final AccountJpaRepository jpa;

    public AccountJpaAdapter(AccountJpaRepository jpa) {
        this.jpa = jpa;
    }

    @Override
    public Optional<Account> findByEmail(String email) {
        return jpa.findByEmail(email).map(AccountMapper::toDomain);
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
