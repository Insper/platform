// VIOLATION: a single fat interface mixes read, write, admin, and reporting.
// Clients that only read data are forced to depend on write and admin methods.
public interface AccountRepository {

    // Read operations
    Optional<Account> findById(String id);
    Optional<Account> findByEmail(String email);
    List<Account> findAll();

    // Write operations
    Account save(Account account);
    void delete(String id);

    // Admin operations — not needed by most clients
    List<Account> findByRole(String role);
    void bulkImport(List<Account> accounts);

    // Reporting — not needed by most clients
    Map<String, Long> countByRegion();
    List<Account> findInactive(Duration since);
}

// ReadOnlyAccountService is forced to implement (or stub) write and admin methods
// even though it never uses them — a clear ISP violation.
