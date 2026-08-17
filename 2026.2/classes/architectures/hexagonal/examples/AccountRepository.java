// Secondary port — defined BY the application core, implemented by the infrastructure.
// Expressed in domain terms: findByEmail, not findByEmailAddress or selectByEmail.
public interface AccountRepository {
    Optional<Account> findByEmail(String email);
    Optional<Account> findById(String id);
    Account save(Account account);
}
