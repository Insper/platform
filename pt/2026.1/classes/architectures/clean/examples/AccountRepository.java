// Entities layer — repository interface (port) declared by the domain.
// The persistence technology is unknown here.
public interface AccountRepository {
    Optional<Account> findById(String id);
    Optional<Account> findByEmail(String email);
    Account save(Account account);
    void delete(String id);
}
