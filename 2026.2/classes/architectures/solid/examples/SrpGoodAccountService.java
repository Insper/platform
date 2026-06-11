// Single responsibility: orchestrate the account-creation use case.
// Validation, persistence, email, and audit are delegated to specialists.
public class AccountService {

    private final AccountRepository repository;
    private final EmailService emailService;
    private final AuditService auditService;

    public AccountService(AccountRepository repository,
                          EmailService emailService,
                          AuditService auditService) {
        this.repository   = repository;
        this.emailService = emailService;
        this.auditService = auditService;
    }

    public Account create(AccountIn in) {
        Account account = Account.of(in);           // validation inside domain object
        repository.save(account);                   // persistence
        emailService.sendWelcome(account.email());  // notification
        auditService.log("account.created", account.id()); // audit
        return account;
    }
}
