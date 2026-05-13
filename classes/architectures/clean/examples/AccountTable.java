// Frameworks & Drivers layer — JPA entity class.
// Carries all ORM annotations so they never appear in domain or use-case classes.
@Entity
@Table(name = "accounts")
public class AccountTable {

    @Id
    @Column(nullable = false, updatable = false)
    private String id;

    @Column(nullable = false)
    private String name;

    @Column(nullable = false, unique = true)
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    // JPA requires a no-arg constructor
    protected AccountTable() {}

    public AccountTable(String id, String name, String email, String passwordHash) {
        this.id           = id;
        this.name         = name;
        this.email        = email;
        this.passwordHash = passwordHash;
    }

    public String getId()           { return id; }
    public String getName()         { return name; }
    public String getEmail()        { return email; }
    public String getPasswordHash() { return passwordHash; }
}
