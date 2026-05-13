// Use Cases layer — application-specific business logic.
// Depends on domain objects and the repository port interface — nothing from Spring.
public class AccountService {

    private final AccountRepository repository;

    public AccountService(AccountRepository repository) {
        this.repository = repository;
    }

    public AccountOut create(AccountIn in) {
        if (repository.findByEmail(in.email()).isPresent())
            throw new DomainException("Email already registered: " + in.email());
        Account account = Account.of(in);
        repository.save(account);
        return AccountOut.from(account);
    }

    public AccountOut findById(String id) {
        return repository.findById(id)
            .map(AccountOut::from)
            .orElseThrow(() -> new NotFoundException("Account not found: " + id));
    }

    public List<AccountOut> findAll() {
        return repository.findAll().stream()
            .map(AccountOut::from)
            .toList();
    }

    public void delete(String id) {
        if (repository.findById(id).isEmpty())
            throw new NotFoundException("Account not found: " + id);
        repository.delete(id);
    }
}
