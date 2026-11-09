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

// A read-only client (e.g. a profile page service) now depends on all nine methods:
// a change to bulkImport() or countByRegion() affects it, and any test fake of this
// interface must stub write, admin and reporting methods it never calls.
